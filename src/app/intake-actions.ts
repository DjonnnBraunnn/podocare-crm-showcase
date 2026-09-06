"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

function emptyToNull(value: FormDataEntryValue | null) {
  const str = String(value ?? "").trim();
  return str.length > 0 ? str : null;
}

export async function submitIntake(token: string, formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) {
    redirect(`/intake/${token}?error=${encodeURIComponent("Укажите имя")}`);
  }

  const photo = formData.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;

  if (hasPhoto) {
    if (!(photo as File).type.startsWith("image/")) {
      redirect(`/intake/${token}?error=${encodeURIComponent("Фото должно быть изображением")}`);
    }
    if ((photo as File).size > MAX_PHOTO_BYTES) {
      redirect(`/intake/${token}?error=${encodeURIComponent("Файл слишком большой (максимум 15 МБ)")}`);
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_client_intake", {
    p_token: token,
    p_full_name: fullName,
    p_phone: emptyToNull(formData.get("phone")),
    p_email: emptyToNull(formData.get("email")),
    p_comment: emptyToNull(formData.get("comment")),
  });

  if (error || !data || data.length === 0) {
    redirect(`/intake/${token}?error=${encodeURIComponent("Не удалось отправить форму, попробуйте ещё раз")}`);
  }

  if (hasPhoto) {
    const { client_id: clientId, workspace_id: workspaceId } = data[0];
    const service = createServiceRoleClient();
    const extension = (photo as File).name.split(".").pop() || "jpg";
    const storagePath = `${workspaceId}/${clientId}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await service.storage
      .from("client-photos")
      .upload(storagePath, photo as File, { contentType: (photo as File).type || undefined });

    if (!uploadError) {
      await service.from("photos").insert({
        workspace_id: workspaceId,
        client_id: clientId,
        storage_path: storagePath,
        phase: "before",
      });
    }
    // A failed photo upload shouldn't block the intake submission itself —
    // the client record and comment are already saved at this point.
  }

  redirect(`/intake/${token}?submitted=1`);
}
