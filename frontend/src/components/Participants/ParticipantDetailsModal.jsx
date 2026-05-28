import { useState, useEffect } from 'react';
import { A11Y_THEME } from '../../styles/accessibilityTheme';
import { getParticipantBumps, sendBump } from '../../api/client';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_SOFT = A11Y_THEME.textSoft;

const CONSENT_COLOR = { full: '#4ade80', partial: '#facc15', withdrawn: '#f87171' };
const CONSENT_LABEL = { full: 'Full Consent', partial: 'Partial Consent', withdrawn: 'Withdrawn' };
const HOME_LABELS   = { studio: 'One Room Studio', 'one-bed': 'One Bedroom', 'two-bed': 'Two Bedroom' };

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase',
      letterSpacing: '0.1em', marginBottom: '14px',
      paddingBottom: '8px', borderBottom: '1px solid #1e1e1e',
    }}>
      {children}
    </div>
  );
}

function Field({ label, value, accent, span }) {
  return (
    <div style={span ? { gridColumn: '1 / -1' } : {}}>
      <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: FS, color: accent || TEXT_SOFT, lineHeight: 1.4 }}>{value || '—'}</div>
    </div>
  );
}

function CheckMark({ checked }) {
  return (
    <div style={{
      width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, marginTop: '1px',
      background: checked ? '#4ade80' : 'transparent',
      border: `1.5px solid ${checked ? '#4ade80' : '#2a2a2a'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && (
        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
          <path d="M1 3.5L3.5 6L8 1" stroke="#111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

const BUMP_REASONS = [
  { value: 'survey_incomplete', label: 'Survey Reminder', placeholder: 'e.g. Please complete your weekly check-in survey.' },
  { value: 'sensor_off',        label: 'Sensor Reminder',  placeholder: 'e.g. Please re-enable your motion sensor.' },
  { value: 'custom',            label: 'Custom Message',   placeholder: 'Enter a message for the participant…' },
];

const REASON_LABEL = Object.fromEntries(BUMP_REASONS.map(r => [r.value, r.label]));

function formatBumpDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

export function ParticipantDetailsModal({ participant, onClose, onNotesUpdate, onBumpSent }) {
  const [notes, setNotes] = useState(participant.notes ?? '');
  const [saved, setSaved]  = useState(false);

  const [bumps, setBumps]           = useState([]);
  const [showSendForm, setShowSendForm] = useState(false);
  const [sendReason, setSendReason]   = useState('survey_incomplete');
  const [sendNote, setSendNote]       = useState('');
  const [sending, setSending]         = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError]     = useState(false);
  const [showBumpDetails, setShowBumpDetails] = useState(false);

  useEffect(() => {
    getParticipantBumps(participant.id)
      .then(data => setBumps(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [participant.id]);

  const handleSendBump = () => {
    setSending(true);
    setSendError(false);
    sendBump(participant.id, sendReason, sendNote)
      .then(newBump => {
        setBumps(prev => [newBump, ...prev]);
        onBumpSent?.();
        setSendSuccess(true);
        setSendNote('');
        setTimeout(() => { setSendSuccess(false); setShowSendForm(false); }, 1500);
      })
      .catch(() => setSendError(true))
      .finally(() => setSending(false));
  };

  const handleSave = () => {
    onNotesUpdate(participant.id, notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const statusColor   = CONSENT_COLOR[participant.consentStatus] ?? '#888';
  const statusLabel   = CONSENT_LABEL[participant.consentStatus] ?? participant.consentStatus;
  const includedSensors = (participant.sensors ?? []).filter(s => s.included);
  const excludedSensors = (participant.sensors ?? []).filter(s => !s.included);
  const consentItems  = participant.consent?.items ?? [];
  const checkedCount  = consentItems.filter(i => i.checked).length;
  const remindersCountLabel = `${bumps.length} reminder${bumps.length === 1 ? '' : 's'}`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#141414', border: '1px solid #242424', borderRadius: '14px',
        width: '720px', maxWidth: '92vw', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: F, boxShadow: '0 32px 64px rgba(0,0,0,0.7)',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '22px 28px 18px', borderBottom: '1px solid #1e1e1e', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: '#1e1e1e', border: '1px solid #2a2a2a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '17px', fontWeight: 700, color: '#b0b0b0',
            }}>
              {participant.id.slice(-2)}
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#e5e5e5', letterSpacing: '0.02em' }}>
                {participant.id}
              </div>
              <div style={{ fontSize: FS, color: TEXT_MUTED, marginTop: '2px' }}>
                {participant.fullName}
              </div>
            </div>
            <div style={{
              marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px',
              background: '#1a1a1a', border: `1px solid ${statusColor}33`,
              borderRadius: '20px', padding: '4px 10px',
            }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor }} />
              <span style={{ fontSize: FS, color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px',
              cursor: 'pointer', color: TEXT_MUTED, fontSize: '18px', lineHeight: 1,
              padding: '4px 9px', fontFamily: F,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = TEXT_PRIMARY; e.currentTarget.style.borderColor = '#3a3a3a'; }}
            onMouseLeave={e => { e.currentTarget.style.color = TEXT_MUTED; e.currentTarget.style.borderColor = '#2a2a2a'; }}
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

          {/* ── Section 1: Participant Info ── */}
          <div>
            <SectionHeader>Participant Info</SectionHeader>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <Field label="Age"                value={participant.age ? `${participant.age} years old` : null} />
              <Field label="Home Type"          value={HOME_LABELS[participant.homeType] || participant.homeType} />
              <Field label="Study Start Date"   value={formatDate(participant.startDate || participant.studyStartDate)} />
              <Field label="Assigned Researcher" value={participant.assignedResearcher} />
              <Field label="Emergency Contact"  value={participant.emergencyName || null} />
              <Field label="Emergency Phone"    value={participant.emergencyPhone || null} />
            </div>
          </div>

          {/* ── Section 2: Sensor Deployment ── */}
          <div>
            <SectionHeader>Sensor Deployment</SectionHeader>
            {participant.sensors ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {includedSensors.map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 12px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '7px',
                  }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                    <span style={{ fontSize: FS, color: TEXT_PRIMARY, minWidth: '140px' }}>{s.name}</span>
                    {s.placementNote ? (
                      <span style={{ fontSize: FS, color: TEXT_MUTED }}>{s.placementNote}</span>
                    ) : (
                      <span style={{ fontSize: FS, color: TEXT_MUTED }}>No placement note</span>
                    )}
                  </div>
                ))}
                {excludedSensors.length > 0 && (
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {excludedSensors.map(s => (
                      <div key={s.id} style={{
                        padding: '4px 10px', background: 'transparent', border: '1px solid #1e1e1e',
                        borderRadius: '20px', fontSize: FS, color: TEXT_MUTED,
                      }}>
                        {s.name} — not deployed
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: FS, color: TEXT_MUTED }}>No sensor data recorded</div>
            )}
          </div>

          {/* ── Section 3: Consent ── */}
          <div>
            <SectionHeader>Consent</SectionHeader>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {consentItems.length > 0 ? consentItems.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <CheckMark checked={item.checked} />
                  <span style={{ fontSize: FS, color: item.checked ? TEXT_SOFT : TEXT_MUTED, lineHeight: 1.4 }}>
                    {item.label}
                  </span>
                </div>
              )) : (
                <div style={{ fontSize: FS, color: TEXT_MUTED }}>No consent data recorded</div>
              )}
            </div>
            {consentItems.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', paddingTop: '14px', borderTop: '1px solid #1a1a1a' }}>
                <Field label="Recorded By"  value={participant.consent?.recordedBy} />
                <Field label="Date Recorded" value={formatDate(participant.consent?.recordedDate)} />
                <Field label="Copy Provided" value={participant.consent?.receivedCopy ? 'Yes' : 'No'} />
              </div>
            )}
            <div style={{ marginTop: '12px', fontSize: FS, color: TEXT_MUTED }}>
              {checkedCount} of {consentItems.length} consent items granted
            </div>
          </div>

          {/* ── Section 4: Reminders ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid #1e1e1e' }}>
              <span style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Reminders{bumps.length > 0 ? ` (${bumps.length} sent)` : ''}
              </span>
              {!showSendForm && (
                <button
                  onClick={() => setShowSendForm(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                    background: '#1a1a2e', border: '1px solid #2a2a4a',
                    color: '#818cf8', fontSize: FS, fontWeight: 500, fontFamily: F,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1e1e3a'; e.currentTarget.style.borderColor = '#3a3a5a'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1a1a2e'; e.currentTarget.style.borderColor = '#2a2a4a'; }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M5.5 1v9M1 5.5h9" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Send Reminder
                </button>
              )}
            </div>

            {showSendForm && (
              <div style={{ background: '#111', border: '1px solid #1e1e3a', borderRadius: '8px', padding: '14px', marginBottom: '14px' }}>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '6px' }}>Reason</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {BUMP_REASONS.map(r => (
                      <button
                        key={r.value}
                        onClick={() => { setSendReason(r.value); setSendNote(''); }}
                        style={{
                          padding: '4px 10px', borderRadius: '5px', cursor: 'pointer',
                          fontSize: FS, fontFamily: F, fontWeight: sendReason === r.value ? 600 : 400,
                          background: sendReason === r.value ? '#1e1e3a' : 'transparent',
                          border: sendReason === r.value ? '1px solid #3a3a6a' : '1px solid #2a2a2a',
                          color: sendReason === r.value ? '#818cf8' : TEXT_MUTED,
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '6px' }}>Message (optional)</div>
                  <textarea
                    value={sendNote}
                    onChange={e => setSendNote(e.target.value)}
                    placeholder={BUMP_REASONS.find(r => r.value === sendReason)?.placeholder}
                    rows={3}
                    style={{
                      width: '100%', resize: 'vertical',
                      background: '#0d0d0d', border: '1px solid #242424', borderRadius: '6px',
                      color: TEXT_SOFT, fontSize: FS, fontFamily: F, lineHeight: 1.5,
                      padding: '8px 10px', boxSizing: 'border-box', outline: 'none',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = '#333'}
                    onBlur={e => e.currentTarget.style.borderColor = '#242424'}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {sendError && (
                    <span style={{ fontSize: FS, color: '#f87171', flex: 1 }}>
                      Failed to send — is the server running?
                    </span>
                  )}
                  <button
                    onClick={() => { setShowSendForm(false); setSendNote(''); setSendError(false); }}
                    style={{ padding: '5px 14px', borderRadius: '6px', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2a2a', color: TEXT_MUTED, fontSize: FS, fontFamily: F }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendBump}
                    disabled={sending || sendSuccess}
                    style={{
                      padding: '5px 16px', borderRadius: '6px', cursor: sending ? 'default' : 'pointer',
                      background: sendSuccess ? '#1a3a1a' : sendError ? '#3a1a1a' : '#1a1a2e',
                      border: sendSuccess ? '1px solid #2a4a2a' : sendError ? '1px solid #4a2a2a' : '1px solid #2a2a4a',
                      color: sendSuccess ? '#4ade80' : sendError ? '#f87171' : '#818cf8',
                      fontSize: FS, fontWeight: 500, fontFamily: F,
                    }}
                  >
                    {sendSuccess ? 'Sent ✓' : sending ? 'Sending…' : sendError ? 'Retry' : 'Send'}
                  </button>
                </div>
              </div>
            )}

            {bumps.length === 0 ? (
              <div style={{ fontSize: FS, color: TEXT_MUTED }}>No reminders sent yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  onClick={() => setShowBumpDetails(prev => !prev)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '7px',
                    cursor: 'pointer',
                    background: '#111',
                    border: '1px solid #1e1e1e',
                    color: TEXT_PRIMARY,
                    fontSize: FS,
                    fontFamily: F,
                  }}
                >
                  <span>{remindersCountLabel}</span>
                  <span style={{ color: TEXT_MUTED }}>{showBumpDetails ? 'Hide details' : 'View details'}</span>
                </button>

                {showBumpDetails && bumps.map(b => (
                  <div key={b.id} style={{ display: 'flex', gap: '10px', padding: '9px 12px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '7px', alignItems: 'flex-start' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: b.read ? '#444' : '#fb923c', flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: b.note ? '3px' : 0 }}>
                        <span style={{ fontSize: FS, color: TEXT_SOFT, fontWeight: 500 }}>{REASON_LABEL[b.reason] ?? b.reason}</span>
                        <span style={{ fontSize: '11px', color: TEXT_MUTED, whiteSpace: 'nowrap', flexShrink: 0 }}>{formatBumpDate(b.timestamp)}</span>
                      </div>
                      {b.note && <div style={{ fontSize: FS, color: TEXT_MUTED, lineHeight: 1.4 }}>{b.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 5: Notes ── */}
          <div>
            <SectionHeader>Notes</SectionHeader>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setSaved(false); }}
              placeholder="Add notes about this participant…"
              style={{
                width: '100%', minHeight: '100px', resize: 'vertical',
                background: '#111', border: '1px solid #242424', borderRadius: '7px',
                color: TEXT_PRIMARY, fontSize: FS, lineHeight: 1.6,
                padding: '10px 12px', fontFamily: F,
                outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#333'}
              onBlur={e => e.currentTarget.style.borderColor = '#242424'}
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          padding: '14px 28px', borderTop: '1px solid #1e1e1e', flexShrink: 0, gap: '10px',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', borderRadius: '7px', cursor: 'pointer',
              background: 'transparent', border: '1px solid #2a2a2a',
              color: TEXT_MUTED, fontSize: FS, fontFamily: F,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#c0c0c0'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#7e7e7e'; }}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '7px 20px', borderRadius: '7px', cursor: 'pointer',
              background: saved ? '#1a3a1a' : '#1e1e1e',
              border: saved ? '1px solid #2a4a2a' : '1px solid #2e2e2e',
              color: saved ? '#4ade80' : '#c0c0c0',
              fontSize: FS, fontWeight: 500, fontFamily: F, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!saved) { e.currentTarget.style.background = '#252525'; e.currentTarget.style.borderColor = '#3a3a3a'; }}}
            onMouseLeave={e => { if (!saved) { e.currentTarget.style.background = '#1e1e1e'; e.currentTarget.style.borderColor = '#2e2e2e'; }}}
          >
            {saved ? 'Saved ✓' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}
