import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  ShieldCheck,
  LogIn,
  LogOut,
  UserCheck,
  Check,
  AlertCircle,
  KeyRound,
  Users,
  Cloud,
  RefreshCw,
} from 'lucide-react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
  firestoreSyncedCount?: number;
  isSyncingFirestore?: boolean;
  onSyncVaultToFirestore?: () => Promise<void>;
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
  firestoreSyncedCount = 0,
  isSyncingFirestore = false,
  onSyncVaultToFirestore,
  onClose,
  onUpdateLocalRole,
  onActivateLocalSession,
  onSignOutSession,
  onNotify,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isCloudGoogleUser = Boolean(
    currentUser && currentUser.uid !== 'local-peer'
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
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
      const fbUser = cred.user;
      const userRef = doc(db, 'users', fbUser.uid);
      const nowIso = new Date().toISOString();
      const emailStr = (fbUser.email || 'peer@relaydrop.app').toLowerCase();
      const isDefaultAdmin = emailStr === 'joyesgrg555@gmail.com';

      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const initialProfile: UserProfile = {
            uid: fbUser.uid,
            email: fbUser.email || 'peer@relaydrop.app',
            displayName:
              fbUser.displayName ||
              (fbUser.email ? fbUser.email.split('@')[0] : 'Google User'),
            photoURL: fbUser.photoURL || '',
            role: isDefaultAdmin ? 'admin' : 'editor',
            deviceModel,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await setDoc(userRef, initialProfile);
        } else {
          await setDoc(
            userRef,
            {
              displayName:
                fbUser.displayName ||
                snap.data().displayName ||
                'Google User',
              photoURL: fbUser.photoURL || snap.data().photoURL || '',
              deviceModel,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }
      } catch (fsErr) {
        try {
          handleFirestoreError(fsErr, OperationType.WRITE, `users/${fbUser.uid}`);
        } catch {
          // Handled structured error
        }
      }

      onNotify(
        `Signed in with Google as ${fbUser.displayName || fbUser.email}`
      );
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Google sign-in could not complete. Check popup permissions or use local peer mode.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateOtherUserRole = async (
    targetUser: UserProfile,
    newRole: UserRole
  ) => {
    if (!currentUser || currentUser.role !== 'admin') return;
    const updated: UserProfile = {
      ...targetUser,
      role: newRole,
      updatedAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'users', targetUser.uid), updated, { merge: true });
      onNotify(
        `Updated ${targetUser.displayName}'s role to ${formatRoleLabel(newRole)}`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      } catch {
        // Handled structured error
      }
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
                  <h2
                    id="auth-modal-title"
                    className="text-base font-bold text-slate-900 truncate"
                  >
                    Google Identity & Firestore Cloud Persistence
                  </h2>
                  <p className="text-xs text-slate-500 truncate">
                    Firebase Authentication · Cloud Firestore Sync · RBAC Governance
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

              {/* Primary Google Sign-In & Cloud Firestore Sync Section (Always accessible when not signed in with Google) */}
              {!isCloudGoogleUser && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-white flex items-center gap-2">
                        <Cloud className="w-4 h-4 text-sky-400" />
                        <span>Sign in with Google (Firebase Auth)</span>
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Authenticate with your Google account to securely identify your device and persist your vault files, categories, and activity logs in Cloud Firestore.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleGoogleSignIn}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap interactive-press"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>
                      {isSubmitting
                        ? 'Connecting to Google Auth...'
                        : 'Continue with Google'}
                    </span>
                  </button>
                </div>
              )}

              {!currentUser ? (
                /* Signed-Out View: Local Peer Session Fallback */
                <div className="space-y-4">
                  {onActivateLocalSession && (
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-900">
                          Instant Local Peer Session (Sandbox Mode)
                        </p>
                        <span className="text-[11px] font-mono text-slate-600 font-semibold">
                          1-Click Access
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Or test room file sharing and RBAC roles locally without a Google popup:
                      </p>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Optional display name (default: Alex Rivera)"
                        className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {(
                          [
                            { role: 'admin', label: 'Local Admin' },
                            { role: 'editor', label: 'Local Editor' },
                            { role: 'viewer', label: 'Local Viewer' },
                          ] as { role: UserRole; label: string }[]
                        ).map((opt) => (
                          <button
                            key={opt.role}
                            type="button"
                            onClick={() => {
                              onActivateLocalSession(
                                opt.role,
                                displayName.trim() || 'Alex Rivera'
                              );
                              onClose();
                            }}
                            className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
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
                </div>
              ) : (
                /* Signed-In View: Profile, Cloud Firestore Persistence Status, Active Role Selector, and Admin User Directory */
                <div className="space-y-5">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {currentUser.photoURL ? (
                        <img
                          src={currentUser.photoURL}
                          alt={currentUser.displayName}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
                          {currentUser.displayName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {currentUser.displayName}
                          </p>
                          <span className="text-[11px] font-mono text-sky-700 font-semibold">
                            {isCloudGoogleUser ? 'Google Auth Verified' : 'Local Session'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          <span>{currentUser.email}</span>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-semibold text-slate-800">
                            Role: {formatRoleLabel(currentUser.role)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                      {isCloudGoogleUser && onSyncVaultToFirestore && (
                        <button
                          type="button"
                          disabled={isSyncingFirestore}
                          onClick={onSyncVaultToFirestore}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              isSyncingFirestore ? 'animate-spin' : ''
                            }`}
                          />
                          <span>
                            {isSyncingFirestore
                              ? 'Syncing...'
                              : `Sync Vault (${firestoreSyncedCount})`}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>

                  {/* Active Role Switcher for Testing & RBAC Enforcement */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                        <span>Your Active Authorization Role</span>
                      </label>
                      <span className="text-[11px] text-slate-500">
                        {isCloudGoogleUser
                          ? 'Persisted to Firestore /users/' + currentUser.uid.slice(0, 6)
                          : 'Switch role to verify RBAC permissions'}
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
                          <span>Firestore Registered Users ({allUsers.length})</span>
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
                              <p className="text-[11px] text-slate-500 truncate">
                                {u.email}
                              </p>
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
                  <span>Firestore Security & RBAC Policy</span>
                </p>
                <div className="text-xs text-slate-600 space-y-1 leading-relaxed">
                  <p>
                    <strong className="text-slate-900">Google Sign-In:</strong> Authenticates your user identity via Firebase Auth and syncs `/users`, `/vault_files`, and `/activity_logs` in Cloud Firestore.
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
