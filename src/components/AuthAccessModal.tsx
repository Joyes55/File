import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  ShieldCheck,
  LogIn,
  LogOut,
  UserCheck,
  Lock,
  Check,
  AlertCircle,
  KeyRound,
  Users,
} from 'lucide-react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import { UserProfile, UserRole, formatRoleLabel } from '../types/files';

interface AuthAccessModalProps {
  isOpen: boolean;
  currentUser: UserProfile | null;
  allUsers: UserProfile[];
  deviceModel: string;
  onClose: () => void;
  onUpdateLocalRole: (role: UserRole) => Promise<void>;
  onActivateLocalSession?: (role: UserRole, displayName?: string) => void;
  onSignOutSession?: () => void;
  onNotify: (message: string) => void;
}

export const AuthAccessModal: React.FC<AuthAccessModalProps> = ({
  isOpen,
  currentUser,
  allUsers,
  deviceModel,
  onClose,
  onUpdateLocalRole,
  onActivateLocalSession,
  onSignOutSession,
  onNotify,
}) => {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [initialRole, setInitialRole] = useState<UserRole>('editor');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      onNotify(`Signed in as ${cred.user.displayName || cred.user.email}`);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Google sign-in could not complete. Try again or use email/password.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === 'signup') {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        const finalName =
          displayName.trim() || email.trim().split('@')[0] || 'Mobile Peer';
        await updateProfile(cred.user, { displayName: finalName });

        const isOwnerEmail =
          email.trim().toLowerCase() === 'joyesgrg555@gmail.com';
        const assignedRole: UserRole = isOwnerEmail ? 'admin' : initialRole;
        const now = new Date().toISOString();
        const profileData: UserProfile = {
          uid: cred.user.uid,
          email: cred.user.email || email.trim(),
          displayName: finalName,
          role: assignedRole,
          deviceModel,
          createdAt: now,
          updatedAt: now,
        };

        try {
          await setDoc(doc(db, 'users', cred.user.uid), profileData);
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, `users/${cred.user.uid}`);
        }

        onNotify(`Account created as ${formatRoleLabel(assignedRole)}`);
        onClose();
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        onNotify(`Signed in as ${cred.user.displayName || cred.user.email}`);
        onClose();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Authentication failed. Check credentials.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateOtherUserRole = async (targetUser: UserProfile, newRole: UserRole) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    const updated: UserProfile = {
      ...targetUser,
      role: newRole,
      updatedAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'users', targetUser.uid), updated, { merge: true });
      onNotify(`Updated ${targetUser.displayName}'s role to ${formatRoleLabel(newRole)}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      setErrorMsg('Could not update user role in Firestore.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      // Ignore if local session
    }
    if (onSignOutSession) {
      onSignOutSession();
    }
    onNotify('Signed out of RelayDrop');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="auth-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 md:p-4"
          onClick={onClose}
        >
          <motion.div
            key="auth-dialog"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            className="w-full max-w-xl bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 max-h-[92vh] flex flex-col overflow-hidden shadow-2xl shadow-slate-950/20"
            onClick={(e) => e.stopPropagation()}
          >
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0 md:hidden" />

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h2 id="auth-modal-title" className="text-base font-bold text-slate-900 truncate">
                Authentication & Role Authorization
              </h2>
              <p className="text-xs text-slate-500 truncate">
                Firebase Identity & Role-Based Access Control (Admin · Editor · Viewer)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!currentUser ? (
            /* Signed-Out View: Instant Local Session, Google Sign-In, or Email/Password */
            <div className="space-y-5">
              {onActivateLocalSession && (
                <div className="p-4 rounded-2xl bg-sky-50/80 border border-sky-200/90 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-900">
                      Instant Local Peer Session (No Popup Required)
                    </p>
                    <span className="text-[11px] font-mono text-sky-700 font-semibold">
                      1-Click Access
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Start an instant peer session to upload, categorize, export CSV, generate QR codes, and test role permissions immediately.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        { role: 'admin', label: 'Continue as Admin' },
                        { role: 'editor', label: 'Continue as Editor' },
                        { role: 'viewer', label: 'Continue as Viewer' },
                      ] as { role: UserRole; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.role}
                        type="button"
                        onClick={() => {
                          onActivateLocalSession(opt.role, displayName.trim() || 'Alex Rivera');
                          onClose();
                        }}
                        className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          opt.role === 'admin'
                            ? 'bg-slate-900 hover:bg-slate-800 text-white'
                            : 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-200'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <p className="text-xs font-semibold text-slate-900">
                  Google Workspace / Firebase Cloud Sign-In
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Sign in with your Google account to sync your profile and role permissions across devices in Cloud Firestore.
                </p>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleGoogleSignIn}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <LogIn className="w-4 h-4 text-sky-400" />
                  <span>Continue with Google</span>
                </button>
              </div>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-slate-200 w-full" />
                <span className="bg-white px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Or Email & Password
                </span>
                <div className="border-t border-slate-200 w-full" />
              </div>

              <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setErrorMsg('');
                  }}
                  className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                    authMode === 'signin'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setErrorMsg('');
                  }}
                  className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                    authMode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-3.5">
                {authMode === 'signup' && (
                  <>
                    <div>
                      <label
                        htmlFor="auth-display-name"
                        className="block text-xs font-semibold text-slate-900 mb-1"
                      >
                        Display Name
                      </label>
                      <input
                        id="auth-display-name"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Alex Rivera"
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-900 mb-1">
                        Initial Authorization Role
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['editor', 'viewer'] as UserRole[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setInitialRole(r)}
                            className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                              initialRole === r
                                ? 'border-sky-600 bg-sky-50 text-sky-900'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {initialRole === r && <Check className="w-3.5 h-3.5 text-sky-600" />}
                            <span>
                              {r === 'editor' ? 'Editor (Upload & Edit)' : 'Viewer (Read-Only)'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-semibold text-slate-900 mb-1"
                  >
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-semibold text-slate-900 mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  {isSubmitting
                    ? 'Authenticating...'
                    : authMode === 'signup'
                    ? 'Create Account & Sign In'
                    : 'Sign In with Email'}
                </button>
              </form>
            </div>
          ) : (
            /* Signed-In View: Profile, Active Role Selector, and Admin User Directory */
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {currentUser.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {currentUser.displayName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      <span>{currentUser.email}</span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span className="font-semibold text-sky-700">
                        Role: {formatRoleLabel(currentUser.role)}
                      </span>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap self-start sm:self-auto"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>

              {/* Active Role Switcher for Testing & RBAC Enforcement */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                    <span>Your Active Authorization Role</span>
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Switch role to verify RBAC permissions
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        role: 'admin',
                        title: 'Admin',
                        desc: 'Full control: upload, recategorize, bulk delete any file & manage user roles.',
                      },
                      {
                        role: 'editor',
                        title: 'Editor',
                        desc: 'Can upload files, create categories, and edit/delete own uploaded files.',
                      },
                      {
                        role: 'viewer',
                        title: 'Viewer',
                        desc: 'Read-only access: search, filter, scan QR codes & download files only.',
                      },
                    ] as { role: UserRole; title: string; desc: string }[]
                  ).map((item) => {
                    const active = currentUser.role === item.role;
                    return (
                      <button
                        key={item.role}
                        type="button"
                        onClick={() => onUpdateLocalRole(item.role)}
                        className={`p-3.5 rounded-2xl border text-left transition-colors flex flex-col justify-between ${
                          active
                            ? 'border-sky-600 bg-sky-50/70'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="text-xs font-bold text-slate-900">
                            {item.title}
                          </span>
                          {active && <Check className="w-4 h-4 text-sky-600" />}
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {item.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin User Directory & Role Assignment */}
              {allUsers.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-500" />
                      <span>Registered Vault Users ({allUsers.length})</span>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {currentUser.role === 'admin'
                        ? 'Admin: You can reassign user roles'
                        : 'Admin role required to reassign other users'}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
                    {allUsers.map((u) => (
                      <div
                        key={u.uid}
                        className="px-4 py-3 bg-white flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {u.displayName}{' '}
                            {u.uid === currentUser.uid && (
                              <span className="text-sky-600">(You)</span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                        </div>

                        <select
                          aria-label={`Role for ${u.displayName}`}
                          disabled={currentUser.role !== 'admin'}
                          value={u.role}
                          onChange={(e) => {
                            const nextRole = e.target.value as UserRole;
                            if (u.uid === currentUser.uid) {
                              onUpdateLocalRole(nextRole);
                            } else {
                              handleUpdateOtherUserRole(u, nextRole);
                            }
                          }}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 disabled:opacity-60"
                        >
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Role Authorization Summary Table */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Authorization Policy Enforcement</span>
            </p>
            <div className="text-xs text-slate-600 space-y-1 leading-relaxed">
              <p>
                <strong className="text-slate-900">Unauthenticated Guest:</strong> Can view shared files and scan room QR codes; must sign in to upload, categorize, or delete files.
              </p>
              <p>
                <strong className="text-slate-900">Viewer:</strong> Read-only access; upload, category creation, and deletion actions are locked.
              </p>
              <p>
                <strong className="text-slate-900">Editor:</strong> Can upload files, add categories, and edit/delete files they own.
              </p>
              <p>
                <strong className="text-slate-900">Admin:</strong> Full vault governance across all files, bulk deletions, and user role assignments.
              </p>
            </div>
          </div>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
