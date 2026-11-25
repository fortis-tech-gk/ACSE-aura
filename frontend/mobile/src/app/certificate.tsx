import React, { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { Redirect } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCachedFetch } from '@/lib/useCachedFetch';
import { useAthleteSession } from '@/lib/athlete-session';
import { certificateHtml, type CertificateData } from '@/lib/certificate-template';
import { CERT_ACS_LOGO, CERT_FONT_CSS, CERT_VTU_LOGO } from '@/lib/certificate-assets';
import { AppHeader, Button, Card, Icon, Muted, OfflineBanner, Screen, colors, fonts } from '@/components/ui';

type CertResponse =
  | { available: true; certificate: CertificateData }
  | { available: false; reason: 'NOT_FINISHED' | 'NOT_PARTICIPATED'; meetEndDate: string };

// A4 landscape in CSS px (297 × 210 mm at 96 dpi); expo-print sizes the single page from these
const PAGE_W = 1123;
const PAGE_H = 794;

export default function CertificateScreen() {
  const { status, token } = useAthleteSession();
  const [busy, setBusy] = useState(false);
  // Cached: once the certificate has been fetched it can be created again offline
  const { data, loading, offline, savedAt, error, reload } = useCachedFetch<CertResponse>('@aura/certificate', '/athlete/certificate', {
    token,
    enabled: !!token,
  });
  const load = reload;

  if (status === 'signedOut') return <Redirect href="/login" />;

  async function download() {
    if (!data || !data.available) return;
    setBusy(true);
    try {
      const html = certificateHtml(data.certificate, { vtuLogo: CERT_VTU_LOGO, hostLogo: CERT_ACS_LOGO, fontCss: CERT_FONT_CSS });
      const { uri } = await Print.printToFileAsync({ html, width: PAGE_W, height: PAGE_H });
      if (await Sharing.isAvailableAsync()) {
        // The share sheet is how Android/iOS let the student "Save to Files / Drive / Gallery" or send it on
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Certificate of Participation' });
      } else {
        Alert.alert('Saved', 'Certificate created, but this device cannot open the share sheet.');
      }
    } catch {
      Alert.alert('Could not create the certificate', 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={load} edges={['bottom']} header={<AppHeader back="More" eyebrow="AURA Athletes" title="Certificate" />}>
      <OfflineBanner offline={offline} lastSyncedAt={savedAt} />

      {error ? (
        <Card style={s.center}>
          <Muted style={s.text}>{error}</Muted>
          <Button title="Try again" onPress={load} variant="secondary" />
        </Card>
      ) : !data ? (
        <Card style={s.center}>
          <Muted style={s.text}>Checking your certificate…</Muted>
        </Card>
      ) : data.available ? (
        <Card style={s.center}>
          <Icon name="medal" size={44} color={colors.gold} />
          <Text style={s.title}>Certificate of Participation</Text>
          <Muted style={s.text}>{data.certificate.athleteName}</Muted>
          <Muted style={s.text}>{data.certificate.collegeName}</Muted>
          <Button title="Download certificate (PDF)" icon="print" variant="gold" loading={busy} onPress={download} style={{ alignSelf: 'stretch', marginTop: 8 }} />
          <Muted style={s.small}>Opens your phone&apos;s share sheet — save it to Files / Drive, or send it on.</Muted>
        </Card>
      ) : data.reason === 'NOT_FINISHED' ? (
        <Card style={s.center}>
          <Icon name="lock" size={40} color={colors.navy} />
          <Text style={s.title}>Available after the meet</Text>
          <Muted style={s.text}>
            Your Certificate of Participation will appear here once Dr. ACS-AURA 2026 is over. Open the app again after the meet to download it.
          </Muted>
        </Card>
      ) : (
        <Card style={s.center}>
          <Icon name="info" size={40} color={colors.navy} />
          <Text style={s.title}>No certificate for this athlete</Text>
          <Muted style={s.text}>
            Certificates are issued to athletes who took part in at least one event. If you competed and this is wrong, please contact the Registration Desk.
          </Muted>
        </Card>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  title: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.navy, textAlign: 'center', marginTop: 4 },
  text: { textAlign: 'center' },
  small: { textAlign: 'center', fontSize: 12 },
});
