import path from "node:path";
import { Document, Page, Text, View, Image, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "PT Sans",
  fonts: [
    { src: path.join(process.cwd(), "src/lib/pdf/fonts/PTSans-Regular.ttf") },
    { src: path.join(process.cwd(), "src/lib/pdf/fonts/PTSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

const styles = StyleSheet.create({
  page: {
    fontFamily: "PT Sans",
    fontSize: 11,
    lineHeight: 1.5,
    color: "#12233F",
    padding: 48,
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#AD8642",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 18,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    paddingBottom: 12,
    borderBottom: "1pt solid #12233F33",
  },
  metaLabel: {
    fontSize: 9,
    color: "#5A6B84",
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 11,
    fontWeight: "bold",
  },
  paragraph: {
    marginBottom: 10,
    textAlign: "justify",
  },
  signatureBlock: {
    marginTop: 32,
  },
  signatureLabel: {
    fontSize: 9,
    color: "#5A6B84",
    marginBottom: 6,
  },
  signatureImage: {
    width: 220,
    height: 90,
    objectFit: "contain",
    border: "1pt solid #12233F33",
  },
  signedAt: {
    marginTop: 8,
    fontSize: 10,
    color: "#5A6B84",
  },
});

export function ConsentDocument({
  workspaceName,
  clientName,
  formText,
  signatureDataUrl,
  signedAt,
}: {
  workspaceName: string;
  clientName: string;
  formText: string;
  signatureDataUrl: string;
  signedAt: string;
}) {
  const paragraphs = formText.split("\n\n").filter(Boolean);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.eyebrow}>PodoCare · {workspaceName}</Text>
        <Text style={styles.title}>Согласие на процедуру</Text>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Клиент</Text>
            <Text style={styles.metaValue}>{clientName}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Дата</Text>
            <Text style={styles.metaValue}>
              {new Date(signedAt).toLocaleDateString("ru-RU")}
            </Text>
          </View>
        </View>

        {paragraphs.map((paragraph, i) => (
          <Text key={i} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}

        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLabel}>Подпись клиента</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={signatureDataUrl} style={styles.signatureImage} />
          <Text style={styles.signedAt}>
            Подписано {new Date(signedAt).toLocaleString("ru-RU")}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
