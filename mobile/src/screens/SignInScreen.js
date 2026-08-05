import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '../theme';
import { Wordmark, Btn } from '../components/ui';
import { useApp } from '../state';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_SECONDS = 30;

export default function SignInScreen({ navigation }) {
  const app = useApp();
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) {
      setError('That email doesn’t look right — check it and try again.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await app.requestCode(addr);
      setEmail(addr);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
      setTimeout(() => codeRef.current && codeRef.current.focus(), 250);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      await app.requestCode(email);
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const { hasProfile } = await app.verifyCode(email, code);
      navigation.reset({ index: 0, routes: [{ name: hasProfile ? 'Main' : 'Onboarding' }] });
    } catch (e) {
      setError(friendly(e));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.wrap}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.bar}>
          <Pressable
            onPress={() => (step === 'code' ? (setStep('email'), setError('')) : navigation.goBack())}
            hitSlop={8}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Wordmark size={22} />
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.body}>
          {step === 'email' ? (
            <>
              <Text style={[type.eyebrow, { color: colors.optic }]}>Sign in</Text>
              <Text style={[type.display, { fontSize: 28 }]}>What's your email?</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(''); }}
                placeholder="you@example.com"
                placeholderTextColor="rgba(244,246,240,0.35)"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoFocus
                onSubmitEditing={sendCode}
                returnKeyType="send"
              />
              <Text style={type.hint}>
                We'll email you a 6-digit code — no password to forget court-side.
              </Text>
              {!app.isBackendConfigured && (
                <View style={styles.demoNote}>
                  <Ionicons name="flask-outline" size={15} color={colors.optic} />
                  <Text style={[type.hint, { flex: 1, fontSize: 12.5 }]}>
                    Demo mode: no email is actually sent — any 6-digit code will work.
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={[type.eyebrow, { color: colors.optic }]}>Check your email</Text>
              <Text style={[type.display, { fontSize: 28 }]}>Enter the code</Text>
              <Text style={type.hint}>
                Sent to <Text style={{ color: colors.text, fontWeight: '700' }}>{email}</Text>
              </Text>
              <TextInput
                ref={codeRef}
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(t) => { setCode(t.replace(/[^0-9]/g, '').slice(0, 6)); setError(''); }}
                placeholder="••••••"
                placeholderTextColor="rgba(244,246,240,0.35)"
                keyboardType="number-pad"
                maxLength={6}
                onSubmitEditing={verify}
                returnKeyType="done"
              />
              <Pressable onPress={resend} disabled={cooldown > 0 || busy} hitSlop={6}>
                <Text style={[styles.resend, (cooldown > 0 || busy) && { color: colors.dim }]}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={{ padding: 18 }}>
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.optic} />
            </View>
          ) : (
            <Btn label={step === 'email' ? 'Send code' : 'Verify'} onPress={step === 'email' ? sendCode : verify} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function friendly(e) {
  const msg = (e && e.message) || '';
  if (/rate/i.test(msg)) return 'Too many attempts — wait a minute and try again.';
  if (/expired|invalid/i.test(msg)) return 'That code didn’t match. Check the newest email or resend.';
  if (/network|fetch/i.test(msg)) return 'No connection — check your internet and try again.';
  return msg || 'Something went wrong. Try again.';
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.night },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  body: { flex: 1, paddingHorizontal: 28, paddingTop: 26, gap: 16 },
  input: {
    borderWidth: 2, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14,
    fontSize: 17, color: colors.text,
  },
  codeInput: { fontSize: 28, fontWeight: '800', letterSpacing: 12, textAlign: 'center' },
  resend: { color: colors.optic, fontWeight: '800', fontSize: 13.5, paddingVertical: 4 },
  error: { color: colors.danger, fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  demoNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 2, borderColor: colors.opticDim, backgroundColor: colors.opticDim,
    borderRadius: 12, padding: 11,
  },
  busy: { height: 52, alignItems: 'center', justifyContent: 'center' },
});
