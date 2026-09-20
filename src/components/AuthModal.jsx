import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes, FaEnvelope, FaLock, FaUser, FaSpinner, FaExclamationCircle, FaCheckCircle, FaEye, FaEyeSlash } from 'react-icons/fa';
import { auth, db, functions } from '../firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  updateProfile 
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const FIREBASE_ERRORS = {
  'auth/invalid-email':               'That email address doesn\'t look right.',
  'auth/user-not-found':              'No account found with that email.',
  'auth/wrong-password':              'Incorrect password. Please try again.',
  'auth/invalid-credential':          'Email or password is incorrect.',
  'auth/email-already-in-use':        'An account with this email already exists.',
  'auth/weak-password':               'Password must be at least 6 characters.',
  'auth/too-many-requests':           'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed':      'Network error. Please check your connection.',
  'auth/user-disabled':               'This account has been disabled. Contact support.',
  'auth/operation-not-allowed':       'This sign-in method is not enabled in Firebase yet.',
  'auth/unauthorized-domain':          'This website is not authorized in Firebase Authentication.',
  'auth/invalid-action-code':          'This authentication link is invalid or has already been used.',
  'auth/expired-action-code':          'This authentication link has expired. Please request a new one.',
  'auth/internal-error':               'Authentication failed temporarily. Please try again.',
};

const getFirebaseError = (err) => {
  const code = err?.code || '';
  if (code === 'functions/internal' || code === 'functions/unavailable') {
    return 'Authentication services are temporarily unavailable. Please try again.';
  }
  return FIREBASE_ERRORS[code] || err?.message || 'Something went wrong. Please try again.';
};

const withTimeout = (promise, message, timeoutMs = 15000) => Promise.race([
  promise,
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeoutMs);
  }),
]);

// Upsert user profile in Firestore (merge so existing data is not overwritten)
const saveUserToFirestore = async (user) => {
  const ref = doc(db, 'users', user.uid);
  await setDoc(ref, {
    uid: user.uid,
    displayName: user.displayName || null,
    email: user.email,
    photoURL: user.photoURL || null,
    emailVerified: user.emailVerified || false,
    lastLoginAt: serverTimestamp(),
  }, { merge: true });
};

const ensureConfiguredAdmin = httpsCallable(functions, 'ensureConfiguredAdmin');

export default function AuthModal({ isOpen, onClose }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      setError('');
      setLoading(false);
      setResetSent(false);
      setShowReset(false);
      setVerificationSent(false);
      setShowPassword(false);
    }
  }, [isOpen]);

  // Clear errors when switching tabs
  const handleSwitchTab = (toLogin) => {
    setIsLogin(toLogin);
    setError('');
    setShowReset(false);
    setResetSent(false);
    setVerificationSent(false);
    setShowPassword(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setLoading(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetSent(true);
    } catch (err) {
      if (!isLogin) {
        await signOut(auth).catch((signOutError) => {
          console.warn('Unable to clear the incomplete signup session:', signOutError);
        });
      }
      setError(getFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        // Sign in with email/password
        const result = await withTimeout(
          signInWithEmailAndPassword(auth, email.trim(), password),
          'Login timed out. Check your connection and try again.'
        );

        const tokenResult = await result.user.getIdTokenResult(true);
        let isAdmin = tokenResult.claims.admin === true;
        if (!isAdmin) {
          try {
            await withTimeout(
              ensureConfiguredAdmin(),
              'Unable to verify administrator access. Please try again.'
            );
            await result.user.getIdToken(true);
            isAdmin = (await result.user.getIdTokenResult()).claims.admin === true;
          } catch (adminError) {
            // A missing or unavailable claim function must not block normal users.
            console.warn('Unable to check admin claim:', adminError);
          }
        }

        if (!result.user.emailVerified && !isAdmin) {
          await withTimeout(
            sendEmailVerification(result.user),
            'Unable to send the verification email. Please try again.'
          );
          await signOut(auth);
          setVerificationSent(true);
          return;
        }

        // Profile persistence must not block a successful login.
        saveUserToFirestore(result.user).catch((error) => {
          console.warn('Unable to sync user profile:', error);
        });
      } else {
        // Register new user
        const userCredential = await withTimeout(
          createUserWithEmailAndPassword(auth, email.trim(), password),
          'Registration timed out. Check your connection and try again.'
        );
        await withTimeout(
          updateProfile(userCredential.user, { displayName: name }),
          'Unable to finish your profile setup. Please try again.'
        );
        await withTimeout(
          sendEmailVerification(userCredential.user),
          'Account created, but the verification email could not be sent. Please try again from the login screen.'
        );

        saveUserToFirestore(userCredential.user).catch((error) => {
          console.warn('Unable to sync user profile:', error);
        });
        await signOut(auth);
        setVerificationSent(true);
        return;
      }

      onClose();
    } catch (err) {
      if (!isLogin && auth.currentUser) {
        await signOut(auth).catch((signOutError) => {
          console.warn('Unable to clear the incomplete signup session:', signOutError);
        });
      }
      setError(getFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <React.Fragment>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[400px] flex-col overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0f19]/95 shadow-2xl shadow-black backdrop-blur-2xl pointer-events-auto"
            >
              <div className="p-5 sm:p-8">
                {/* Header */}
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center overflow-hidden">
                      <img src="/noctiva-logo.png" alt="NOCTIVA" className="h-full w-full object-cover" />
                    </div>
                    <span className="text-xl font-black text-white tracking-tight">
                      NOC<span className="text-red-500">TIVA</span>
                    </span>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
                  >
                    <FaTimes />
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-6">
                  <button
                    type="button"
                    onClick={() => handleSwitchTab(true)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${
                      isLogin ? 'bg-red-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Log In
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchTab(false)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${
                      !isLogin ? 'bg-red-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Sign Up
                  </button>
                </div>

                {/* Info Note / Error */}
                {verificationSent ? (
                  <div className="flex flex-col items-center gap-4 py-5 text-center">
                    <FaCheckCircle className="text-green-400 text-4xl" />
                    <h2 className="text-lg font-bold text-white">Check your email</h2>
                    <p className="text-sm leading-relaxed text-gray-400">
                      We sent a verification link to <span className="font-semibold text-gray-200">{email}</span>.
                      Verify your email before logging in.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setIsLogin(true); setVerificationSent(false); setError(''); }}
                      className="text-sm font-semibold text-red-400 underline underline-offset-2 transition-colors hover:text-red-300"
                    >
                      Back to Log In
                    </button>
                  </div>
                ) : <AnimatePresence mode="wait">
                  {error ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-start gap-2.5 mb-6 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3"
                    >
                      <FaExclamationCircle className="text-red-400 text-base shrink-0 mt-0.5" />
                      <p className="text-red-300 text-sm font-medium leading-snug">{error}</p>
                    </motion.div>
                  ) : (
                    <motion.p
                      key="hint"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-gray-400 text-sm mb-6 text-center"
                    >
                      {isLogin
                        ? 'Welcome back! Sign in to access your Watchlist.'
                        : 'Create an account to save movies and sync progress.'}
                    </motion.p>
                  )}
                </AnimatePresence>}

                {/* Form OR Forgot Password */}
                {!verificationSent && showReset ? (
                  <form className="space-y-4" onSubmit={handleForgotPassword}>
                    {resetSent ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center gap-3 py-4 text-center"
                      >
                        <FaCheckCircle className="text-green-400 text-4xl" />
                        <p className="text-green-300 font-semibold text-sm">Reset email sent!</p>
                        <p className="text-gray-500 text-xs">Check your inbox for a password reset link from Firebase.</p>
                        <button
                          type="button"
                          onClick={() => { setShowReset(false); setResetSent(false); setError(''); }}
                          className="mt-2 text-sm text-red-400 hover:text-red-300 font-semibold underline underline-offset-2 transition-colors"
                        >
                          ← Back to Log In
                        </button>
                      </motion.div>
                    ) : !verificationSent && (
                      <>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                            <FaEnvelope className="text-gray-500 text-sm" />
                          </div>
                          <input
                            type="email"
                            required
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder="Your email address"
                            className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 transition-all font-medium text-sm"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full py-3.5 flex justify-center items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(220,38,38,0.3)] transition-all active:scale-[0.98]"
                        >
                          {loading && <FaSpinner className="animate-spin" />}
                          Send Reset Link
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowReset(false); setError(''); }}
                          className="w-full text-sm text-gray-500 hover:text-gray-300 font-semibold transition-colors py-1"
                        >
                          ← Back to Log In
                        </button>
                      </>
                    )}
                  </form>
                ) : (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  {!isLogin && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }} 
                      animate={{ opacity: 1, height: 'auto' }} 
                      exit={{ opacity: 0, height: 0 }}
                      className="relative"
                    >
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                        <FaUser className="text-gray-500 text-sm" />
                      </div>
                      <input
                        type="text"
                        required={!isLogin}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Full Name"
                        className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 transition-all font-medium text-sm"
                      />
                    </motion.div>
                  )}

                  <div className="relative">
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                      <FaEnvelope className="text-gray-500 text-sm" />
                    </div>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email Address"
                      className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 transition-all font-medium text-sm"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                      <FaLock className="text-gray-500 text-sm" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-11 pr-11 text-sm font-medium text-white placeholder-gray-500 transition-all focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-3 flex items-center px-1 text-gray-500 transition-colors hover:text-white"
                    >
                      {showPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>

                  {isLogin && (
                    <div className="flex justify-end -mt-1">
                      <button
                        type="button"
                        onClick={() => { setShowReset(true); setResetEmail(email); setError(''); }}
                        className="text-xs text-gray-500 hover:text-red-400 font-semibold underline underline-offset-2 transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 mt-2 flex justify-center items-center gap-2 disabled:opacity-50 text-white font-bold rounded-xl transition-all active:scale-[0.98] ${
                      'bg-red-600 hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.3)]'
                    }`}
                  >
                    {loading && <FaSpinner className="animate-spin" />}
                    {isLogin ? 'Continue' : 'Create Account'}
                  </button>
                </form>
                )}

              </div>
            </motion.div>
          </div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}

AuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
