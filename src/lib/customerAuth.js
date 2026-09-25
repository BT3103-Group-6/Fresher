// FR-03: Firebase Phone Auth for customers. In dev the Auth emulator prints the OTP in its terminal.
import { PhoneAuthProvider, RecaptchaVerifier, signInWithCredential, signInWithPhoneNumber } from 'firebase/auth'
import { auth } from '@/firebase'

if (import.meta.env.DEV) auth.settings.appVerificationDisabledForTesting = true

/** "9123 4567", "+65 91234567" -> "+6591234567"; null if it is not a Singapore mobile (8 or 9 first). */
export function normalizeSgMobile(input) {
  const digits = String(input).replace(/[\s-]/g, '').replace(/^\+?65/, '')
  return /^[89]\d{7}$/.test(digits) ? `+65${digits}` : null
}

let verifier
let confirmation

export async function sendOtp(e164, containerId) {
  // A fresh verifier per send: a used reCAPTCHA widget cannot be reused after a failure.
  verifier?.clear()
  verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
  try {
    confirmation = await signInWithPhoneNumber(auth, e164, verifier)
  } catch (err) {
    verifier.clear()
    verifier = undefined
    throw err
  }
}

/** Resolves the signed-in customer; rejects with an auth/* error on a wrong or expired code. */
export async function verifyOtp(code) {
  if (!confirmation) throw Object.assign(new Error('No code was requested.'), { code: 'app/no-otp' })
  const { user } = await confirmation.confirm(code)
  return user
}

export function otpErrorMessage(err) {
  switch (err.code) {
    case 'auth/invalid-verification-code': return 'That code is not correct.'
    case 'auth/code-expired': return 'That code has expired. Request a new one.'
    case 'auth/too-many-requests': return 'Too many attempts. Wait a moment and try again.'
    case 'auth/network-request-failed': return 'Network problem. Check your connection and try again.'
    case 'auth/invalid-phone-number': return 'Enter a valid Singapore mobile number.'
    default: return 'Could not verify your number. Try again.'
  }
}
