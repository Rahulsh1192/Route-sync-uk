import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Entitlements, canApplyAsInstructor } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function AccountPage() {
  const { logout, user, isStaff } = useAuth();
  const nav = useNavigate();
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  // Held as strings, never null, so an emptied input round-trips as '' — which the API
  // reads as "clear this field" rather than "leave it alone".
  const [contact, setContact] = useState({
    phone: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setContact({
      phone: user.phone ?? '',
      emergencyContactName: user.emergencyContactName ?? '',
      emergencyContactPhone: user.emergencyContactPhone ?? '',
    });
  }, [user]);

  async function saveContact() {
    setSavingContact(true);
    setContactError(null);
    setContactSaved(false);
    try {
      await api.updateMe(contact);
      setContactSaved(true);
    } catch (e) {
      setContactError((e as Error).message);
    } finally {
      setSavingContact(false);
    }
  }

  useEffect(() => {
    api.me().then(setEnt).catch(() => {});
    // Show install button if the browser already has the prompt ready
    setCanInstall(!!(window as any).__pwaInstall);
    const handler = () => setCanInstall(true);
    window.addEventListener('pwa-installable', handler);
    return () => window.removeEventListener('pwa-installable', handler);
  }, []);

  async function installApp() {
    const prompt = (window as any).__pwaInstall;
    if (!prompt) return;
    setInstalling(true);
    await prompt();
    setInstalling(false);
    setCanInstall(false);
  }

  const premium = ent?.entitlements.multiView ?? false;
  // Number of distinct test centres unlocked (null = a universal/legacy grant).
  const centreCount = ent?.premiumTestCentreIds?.filter((c) => c !== null).length ?? 0;
  const hasUniversal = ent?.premiumTestCentreIds?.includes(null) ?? false;

  return (
    <>
      <h1 className="page">Account</h1>

      <div className="card">
        <div className="row">
          <span style={{ fontSize: 22 }}>{premium ? '⭐' : '👤'}</span>
          <div>
            <div style={{ fontWeight: 700 }}>
              {ent == null ? 'Loading…' : premium ? `Premium (${ent.plan})` : 'Free plan'}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {!premium
                ? 'Demo — one route total. Upgrade for unlimited routes at a test centre.'
                : hasUniversal
                ? 'All test centres unlocked'
                : `Premium for ${centreCount} test centre${centreCount === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className="spacer" />
          {!premium && (
            <button className="btn auto" onClick={() => nav('/paywall')}>
              Upgrade
            </button>
          )}
        </div>
      </div>

      {/* Contact details (Phase 26). Editable here rather than only at signup, because
          that is where existing accounts and Google/Apple sign-ins can supply them — none
          of those went through a form that asked. */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Contact details</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Optional. Used by staff to reach you about a lesson or a booking. Clear a field
          and save to remove it.
        </div>

        <label>Mobile number</label>
        <input
          type="tel"
          value={contact.phone}
          onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          placeholder="e.g. 07700 900123"
          autoComplete="tel"
        />

        <label>Emergency contact name</label>
        <input
          value={contact.emergencyContactName}
          onChange={(e) => setContact({ ...contact, emergencyContactName: e.target.value })}
        />

        <label>Emergency contact number</label>
        <input
          type="tel"
          value={contact.emergencyContactPhone}
          onChange={(e) => setContact({ ...contact, emergencyContactPhone: e.target.value })}
        />

        {contactError && <div className="error" style={{ marginTop: 8 }}>{contactError}</div>}
        {contactSaved && (
          <div style={{ color: 'var(--color-green)', fontSize: 13, marginTop: 8 }}>
            Contact details saved.
          </div>
        )}
        <button
          className="btn"
          style={{ marginTop: 10 }}
          disabled={savingContact}
          onClick={saveContact}
        >
          {savingContact ? 'Saving…' : 'Save contact details'}
        </button>
      </div>

      <div className="card">
        <div className="row">
          <span style={{ fontSize: 18 }}>🏫</span>
          <div>
            <strong>Book a driving instructor</strong>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Find and book a verified ADI near you. No Premium subscription required.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn secondary auto" onClick={() => nav('/discover')}>
            Browse routes
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span style={{ fontSize: 18 }}>📊</span>
          <div>
            <strong>My Progress</strong>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Track routes watched, practice runs, and your learning streak.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn secondary auto" onClick={() => nav('/account/progress')}>
            View progress
          </button>
        </div>
      </div>

      {/* Instructors/admins get the contributor tools; normal users get a clear
          path to apply as an instructor (approved by an admin). */}
      {isStaff ? (
        <div className="card">
          <strong>Contribute a route</strong>
          <p className="muted" style={{ fontSize: 14 }}>
            Recording front + rear dashcam clips and a GPX track? Upload them, track processing,
            and earn credits &amp; badges.
          </p>
          <button className="btn secondary" onClick={() => nav('/contribute')}>
            Open contributor tools
          </button>
        </div>
      ) : canApplyAsInstructor(user?.role) ? (
        <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="row">
            <span style={{ fontSize: 22 }}>🎓</span>
            <div>
              <strong>Become an Instructor</strong>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
                Are you a DVSA-approved driving instructor? Apply to upload routes and manage
                test centres. An admin verifies your ADI number before you're approved.
              </p>
            </div>
            <div className="spacer" />
            <button className="btn auto" onClick={() => nav('/contribute/instructor')}>
              Become an Instructor
            </button>
          </div>
        </div>
      ) : null}

      {canInstall && (
        <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="row">
            <span style={{ fontSize: 22 }}>📲</span>
            <div>
              <strong>Install Test Routify</strong>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
                Add to your home screen for offline access and a faster experience.
              </p>
            </div>
            <div className="spacer" />
            <button className="btn auto" disabled={installing} onClick={installApp}>
              {installing ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
      )}

      <button className="btn secondary" onClick={logout} style={{ marginTop: 8 }}>
        Sign out
      </button>
    </>
  );
}
