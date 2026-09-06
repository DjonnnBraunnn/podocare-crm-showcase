/**
 * Everything the app knows about a workspace's subscription.
 *
 * Deliberately a plain module, not a "use server" file: every export of a
 * "use server" file is a publicly callable POST endpoint, and none of this
 * should be one. Same reason `src/lib/errors.ts` and `src/lib/workspace.ts`
 * live here.
 *
 * The database stores two facts — `plan` and `paid_through` (see
 * supabase/migrations/0017_subscriptions.sql). Status is derived here, never
 * stored, because a stored status is wrong from midnight until whatever job
 * would refresh it runs.
 */
import { toISODate } from "@/lib/utils";

export type SubscriptionPlan = "trial" | "standard" | "pro";

/**
 * `unknown` is the "no row in workspace_subscriptions" case. It is treated as
 * *not blocked* — see `blocked` below.
 */
export type SubscriptionStatus = "trial" | "active" | "grace" | "expired" | "unknown";

export type SubscriptionState = {
  plan: SubscriptionPlan | null;
  /** ISO date (YYYY-MM-DD) the subscription is paid up to, inclusive. */
  paidThrough: string | null;
  /**
   * Доступ без срока (0059).
   *
   * Перевешивает `paidThrough`: дата остаётся в базе нетронутой, чтобы снятие
   * бессрочного доступа вернуло ровно её, — но пока флаг стоит, кабинет не
   * блокируется и даты не показывает. «Оплачено по 2036 год» — это не
   * «навсегда», это обещание, которое читают как «когда-нибудь отберут».
   */
  perpetual: boolean;
  /**
   * Оператор закрыл доступ вручную (0060).
   *
   * Перевешивает всё, включая бессрочный доступ: «приостановлено» — это
   * решение человека, и дата с флагом его не отменяют. Данные при этом
   * остаются на месте, возврат — тем же нажатием.
   */
  suspended: boolean;
  /** Тариф, назначенный оператором (0060). `auto` — считать по числу сотрудников. */
  tier: TierOverride;
  status: SubscriptionStatus;
  /** Days from today to `paid_through`. 0 = expires today, negative = past. */
  daysRemaining: number | null;
  /** Days of grace still left once `paid_through` is behind us. */
  graceDaysLeft: number | null;
  /** True once even the grace period is over — the paywall condition. */
  blocked: boolean;
  /** Worth telling the clinic about before it becomes a problem. */
  expiringSoon: boolean;
};

/**
 * 14 days. A podiatry clinic's own cadence is the argument: clients come back
 * every 3–4 weeks, so a 7-day trial ends before a single repeat visit appears
 * and Статистика — the section that actually sells the product — is still
 * empty when the trial dies. 14 days covers two full working weeks. 30 is a lot
 * of free software when every sale is a manual conversation anyway.
 *
 * Mirrored in 0017_subscriptions.sql (handle_new_user). Changing it here does
 * NOT change what new signups get; this constant exists so the UI can say
 * "14 дней" without hardcoding a number in three templates.
 */
export const TRIAL_DAYS = 14;

/**
 * 3 days past `paid_through` before anything is blocked.
 *
 * Payment is confirmed by a human out of band, so the failure mode being
 * guarded against is not "the clinic refuses to pay", it is "the transfer
 * landed on Saturday and the operator is at a wedding". Three days is the
 * shortest window that always spans a weekend: a subscription ending on Friday
 * survives until Monday. Cutting access at midnight sharp would lock a clinic
 * out mid-appointment over a payment that is a few hours late, in a system that
 * holds their patients' medical history.
 */
export const GRACE_DAYS = 3;

/** Start warning the clinic a week out, so expiry is never a surprise. */
export const EXPIRY_WARNING_DAYS = 7;

/**
 * Настройки платформы, как их видит приложение.
 *
 * Живут в `platform_settings` (0035) и читаются через `getPlatformSettings()`:
 * цена и номер для связи — коммерческие решения, они меняются быстрее, чем
 * выкатывается образ, и тому, кто их принимает, не должен быть нужен доступ к
 * серверу.
 *
 * `billingContact` может быть пустым, и это нормальное состояние, а не ошибка.
 * Здесь стоял запасной номер — и это был настоящий номер конкретной клиники,
 * который показывался на странице оплаты всем остальным клиникам. Запасного
 * номера не бывает: либо оператор его задал, либо страница честно говорит, что
 * контакт не указан.
 */
export type PlatformSettings = {
  monthlyPriceKzt: number | null;
  yearlyPriceKzt: number | null;
  /** Второй тариф — для кабинета с командой. Пустой значит «одна цена для всех». */
  teamPriceKzt: number | null;
  teamYearlyPriceKzt: number | null;
  /** С какого числа сотрудников включается командный тариф. */
  teamThreshold: number;
  /**
   * Потолок мест на командном тарифе (0063). Пусто — без потолка.
   *
   * Нужен не против «перепродажи» — база у кабинета одна, и раздать её десяти
   * клиникам нельзя, — а против коллектива мастеров, которые снимают места в
   * одном кабинете и платят одну цену вместо восьми. Это законный случай, но
   * разговор о цене в нём должен начинаться с нашей стороны.
   */
  teamSeatLimit: number | null;
  billingContact: string | null;
  billingNote: string | null;
  trialDays: number;
  graceDays: number;
};

export const PLATFORM_SETTINGS_DEFAULTS: PlatformSettings = {
  monthlyPriceKzt: null,
  yearlyPriceKzt: null,
  teamPriceKzt: null,
  teamYearlyPriceKzt: null,
  teamThreshold: 3,
  teamSeatLimit: null,
  billingContact: null,
  billingNote: null,
  trialDays: 14,
  graceDays: GRACE_DAYS,
};

/** Что оператор назначил кабинету: считать самому или конкретный тариф (0060). */
export type TierOverride = "auto" | "base" | "team";

export const TIER_LABELS: Record<TierOverride, string> = {
  auto: "По числу сотрудников",
  base: "Одиночный",
  team: "Командный",
};

export type ResolvedPrice = {
  monthly: number | null;
  yearly: number | null;
  /** `team` — кабинет попал в командный тариф; `base` — в одиночный. */
  tier: "base" | "team";
  /** Показывать ли «от», то есть есть ли вообще две разные цены. */
  hasTiers: boolean;
};

/**
 * Какая цена относится к кабинету с таким числом сотрудников.
 *
 * Отдельная чистая функция по той же причине, что и `resolveSubscription`:
 * правило нужно в трёх местах — на экране оплаты клиники, в консоли оператора и
 * на посадочной, — и три копии разъезжаются молча.
 *
 * Командный тариф применяется, только если он вообще задан. Пустой командный
 * тариф это не ошибка, а «одна цена для всех» — то состояние, в котором
 * платформа жила до появления второго тарифа, и в которое её можно вернуть,
 * стерев одно поле.
 *
 * `staffCount === null` — «не знаем» (например, оператор смотрит список, где
 * счёт не запрашивался). Тогда берётся базовый тариф: назвать клинике меньшую
 * из двух цен и поправиться потом лучше, чем наоборот.
 */
export function resolvePrice(
  settings: PlatformSettings,
  staffCount: number | null,
  /**
   * Что оператор назначил кабинету явно (0060).
   *
   * `auto` — прежнее поведение, считать по числу заведённых сотрудников.
   * Оно врёт ровно в том случае, ради которого назначение и появилось:
   * клиника из четверых в первый день заведена одним человеком, видит 25 000,
   * а счёт получает на 40 000.
   */
  tier: TierOverride = "auto",
): ResolvedPrice {
  const hasTeamTier = settings.teamPriceKzt != null || settings.teamYearlyPriceKzt != null;
  const isTeam =
    hasTeamTier &&
    (tier === "team" ||
      (tier === "auto" && staffCount != null && staffCount >= settings.teamThreshold));

  return {
    monthly: isTeam ? settings.teamPriceKzt : settings.monthlyPriceKzt,
    yearly: isTeam ? settings.teamYearlyPriceKzt : settings.yearlyPriceKzt,
    tier: isTeam ? "team" : "base",
    // Две цены есть только когда они действительно разные: командный тариф,
    // равный базовому, — это одна цена, записанная дважды, и «от 25 000» рядом
    // с единственной цифрой 25 000 читается как уловка.
    hasTiers:
      hasTeamTier &&
      settings.monthlyPriceKzt != null &&
      settings.teamPriceKzt != null &&
      settings.teamPriceKzt !== settings.monthlyPriceKzt,
  };
}

/**
 * Сколько человек помещается в кабинет на его тарифе. `null` — без предела.
 *
 * Зеркало `workspace_seat_limit()` из 0062, и намеренно зеркало, а не
 * единственная реализация: запрещает база — триггером на вставку, который
 * переживёт и служебный ключ, и регистрацию по приглашению. Здесь то же
 * правило нужно раньше отказа — чтобы кабинет видел «занято 2 из 2» до того,
 * как заполнит форму, а не вместо ответа на неё.
 *
 * Предел считается от порога командного тарифа: при пороге 3 одиночный тариф —
 * это двое. Отдельного числа нет специально, иначе однажды поменяют одно и
 * забудут второе.
 *
 * Два случая без предела, и оба — не «забыли настроить»:
 *   * `auto` и `team` — на `auto` третий сотрудник поднимает цену, а не
 *     запрещён, иначе в командный тариф нельзя было бы попасть вовсе;
 *   * командный тариф не задан — предлагать «перейдите на командный» некуда.
 */
export function resolveSeatLimit(
  settings: PlatformSettings,
  tier: TierOverride,
  /**
   * Мест именно этому кабинету (0063). Перевешивает и тариф, и общий потолок:
   * заводится ради случая, который в общее правило не укладывается — клинике
   * из пяти продали пять мест, коллективу мастеров десять.
   */
  workspaceSeatLimit: number | null = null,
): number | null {
  if (workspaceSeatLimit != null) return workspaceSeatLimit;
  if (tier === "base") {
    if (settings.teamPriceKzt == null && settings.teamYearlyPriceKzt == null) return null;
    return Math.max(settings.teamThreshold - 1, 1);
  }
  // Командный и «по числу сотрудников» упираются в общий потолок платформы,
  // обычно пустой. `auto` включён сюда намеренно: иначе правило обходилось бы
  // одним значением тарифа, а по умолчанию все кабинеты именно на `auto`.
  return settings.teamSeatLimit;
}

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  trial: "Пробный период",
  standard: "Стандарт",
  pro: "Про",
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: "Пробный период",
  active: "Активна",
  grace: "Продлите оплату",
  expired: "Приостановлена",
  unknown: "Не настроена",
};

const PLANS: SubscriptionPlan[] = ["trial", "standard", "pro"];

function asPlan(value: string | null): SubscriptionPlan | null {
  return value != null && (PLANS as string[]).includes(value) ? (value as SubscriptionPlan) : null;
}

/**
 * Whole calendar days between two ISO dates. Goes through Date.UTC rather than
 * subtracting local Date objects: a DST boundary inside the range makes the
 * millisecond difference 23 or 25 hours and rounds a "1 day left" into "0".
 */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function resolveSubscription(
  plan: string | null,
  paidThrough: string | null,
  today: string = toISODate(new Date()),
  perpetual: boolean = false,
  suspended: boolean = false,
  tier: TierOverride = "auto",
): SubscriptionState {
  const resolvedPlan = asPlan(plan);

  // Ручная приостановка отвечает первой — раньше даты и раньше бессрочного
  // доступа. Иначе кабинет, которому доступ отдан навсегда, нельзя было бы
  // закрыть вовсе, а «навсегда» не должно означать «несмотря ни на что».
  if (suspended) {
    return {
      plan: resolvedPlan,
      paidThrough,
      perpetual,
      suspended: true,
      tier,
      status: "expired",
      daysRemaining: null,
      graceDaysLeft: null,
      blocked: true,
      expiringSoon: false,
    };
  }

  // Бессрочный доступ отвечает раньше остальных правил — считать по нему дни,
  // льготный период и «скоро истечёт» просто не из чего.
  if (perpetual) {
    return {
      plan: resolvedPlan,
      paidThrough,
      perpetual: true,
      suspended: false,
      tier,
      status: "active",
      daysRemaining: null,
      graceDaysLeft: null,
      blocked: false,
      expiringSoon: false,
    };
  }

  if (!paidThrough) {
    // No billing row at all. Fail OPEN, on purpose.
    //
    // Nobody holds a DELETE privilege on workspace_subscriptions (0017 grants
    // no delete policy to anyone), and handle_new_user creates the row inside
    // the signup transaction, so "no row" cannot be produced by a clinic trying
    // to dodge the paywall. It can only mean our own bookkeeping missed a
    // workspace — or that the app was deployed before the migration was
    // applied. Failing closed would then paywall a paying clinic's medical
    // records because of our mistake, which is strictly worse than serving one
    // workspace for free until somebody notices it in /admin.
    return {
      plan: resolvedPlan,
      paidThrough: null,
      perpetual: false,
      suspended: false,
      tier,
      status: "unknown",
      daysRemaining: null,
      graceDaysLeft: null,
      blocked: false,
      expiringSoon: false,
    };
  }

  const daysRemaining = daysBetween(today, paidThrough);
  const graceDaysLeft = daysRemaining >= 0 ? GRACE_DAYS : GRACE_DAYS + daysRemaining;
  const blocked = graceDaysLeft < 0;

  let status: SubscriptionStatus;
  if (blocked) status = "expired";
  else if (daysRemaining < 0) status = "grace";
  else if (resolvedPlan === "trial") status = "trial";
  else status = "active";

  return {
    plan: resolvedPlan,
    paidThrough,
    perpetual: false,
    suspended: false,
    tier,
    status,
    daysRemaining,
    graceDaysLeft: daysRemaining >= 0 ? null : graceDaysLeft,
    blocked,
    expiringSoon: !blocked && daysRemaining <= EXPIRY_WARNING_DAYS,
  };
}

/** "5 августа 2026" — the paid-through date, spelled out so it cannot be misread. */
export function formatSubscriptionDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "осталось 3 дня" / "остался 1 день" / "осталось 14 дней" */
export function formatDaysRemaining(days: number): string {
  const abs = Math.abs(days);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word: string;
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "дня";
  else word = "дней";
  return `${abs} ${word}`;
}
