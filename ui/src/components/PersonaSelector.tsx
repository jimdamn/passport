import { useState } from 'react';

export interface PersonaSelectorProps {
  currentPersona: 'anonymous' | 'personal' | 'business';
  businessVerified: boolean;
  onSwitch: (persona: 'anonymous' | 'personal' | 'business') => Promise<void>;
}

export function PersonaSelector({
  currentPersona,
  businessVerified,
  onSwitch,
}: PersonaSelectorProps) {
  const [loadingPersona, setLoadingPersona] = useState<'anonymous' | 'personal' | 'business' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSwitch = async (persona: 'anonymous' | 'personal' | 'business') => {
    if (persona === currentPersona) return;
    if (persona === 'business' && !businessVerified) return;
    if (loadingPersona) return;

    setLoadingPersona(persona);
    setErrorMsg(null);

    try {
      await onSwitch(persona);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to switch persona');
    } finally {
      setLoadingPersona(null);
    }
  };

  const options = [
    {
      type: 'anonymous' as const,
      icon: '👤',
      label: 'Anonymous',
      sub: 'Posts without your name',
      disabled: false,
    },
    {
      type: 'personal' as const,
      icon: '🙋',
      label: 'Personal',
      sub: 'Posts as your display name',
      disabled: false,
    },
    {
      type: 'business' as const,
      icon: '🏪',
      label: 'Business',
      sub: 'Posts as your business',
      disabled: !businessVerified,
      disabledText: 'Requires verified business',
    },
  ];

  return (
    <div className="persona-selector-container">
      <style>{`
        .persona-selector-container {
          width: 100%;
          font-family: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
          margin: 16px 0;
        }
        .persona-selector-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .persona-card {
          border-radius: var(--r-md, 12px);
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          user-select: none;
          min-height: 120px;
          justify-content: center;
          box-sizing: border-box;
        }
        .persona-card.active {
          background-color: var(--dark, #1e3320);
          color: var(--amber, #e8b84b);
          cursor: default;
        }
        .persona-card.inactive {
          background-color: var(--offwhite, #f4f7f4);
          color: var(--ink, #2a3a2a);
          border: 1px solid var(--forest, #507850);
        }
        .persona-card.inactive:hover:not(.disabled) {
          filter: brightness(0.95);
        }
        .persona-card.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background-color: var(--offwhite, #f4f7f4);
          color: var(--ink, #2a3a2a);
          border: 1px dashed var(--rule, #d0ddd0);
        }
        .persona-icon {
          font-size: 1.5rem;
          margin-bottom: 8px;
        }
        .persona-label {
          font-weight: 600;
          font-size: 0.95rem;
          margin-bottom: 4px;
        }
        .persona-sub {
          font-size: 0.75rem;
          opacity: 0.8;
          line-height: 1.3;
        }
        .persona-disabled-text {
          font-size: 0.7rem;
          color: #a30000;
          margin-top: 6px;
          font-weight: 500;
        }
        .persona-status-text {
          font-size: 0.85rem;
          margin-top: 12px;
          text-align: center;
          min-height: 1.2rem;
        }
        .persona-loading-text {
          color: var(--forest, #507850);
          font-style: italic;
        }
        .persona-error-text {
          color: #b94a4a;
          font-weight: 500;
        }
        @media (max-width: 640px) {
          .persona-selector-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .persona-card {
            min-height: auto;
            flex-direction: row;
            text-align: left;
            align-items: center;
            justify-content: flex-start;
            padding: 12px 16px;
          }
          .persona-icon {
            margin-bottom: 0;
            margin-right: 16px;
            font-size: 1.3rem;
          }
          .persona-details {
            display: flex;
            flex-direction: column;
          }
          .persona-disabled-text {
            margin-top: 2px;
          }
        }
      `}</style>
      <div className="persona-selector-grid">
        {options.map((opt) => {
          const isActive = currentPersona === opt.type;
          const isCurrentlyLoading = loadingPersona === opt.type;
          const cardClass = isActive
            ? 'persona-card active'
            : opt.disabled
            ? 'persona-card disabled'
            : 'persona-card inactive';

          return (
            <div
              key={opt.type}
              className={`${cardClass} ${opt.disabled ? 'disabled' : ''}`}
              onClick={() => handleSwitch(opt.type)}
            >
              <div className="persona-icon">{opt.icon}</div>
              <div className="persona-details">
                <div className="persona-label">
                  {opt.label} {isCurrentlyLoading && '...'}
                </div>
                <div className="persona-sub">{opt.sub}</div>
                {opt.disabled && opt.disabledText && (
                  <div className="persona-disabled-text">{opt.disabledText}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="persona-status-text">
        {loadingPersona && (
          <span className="persona-loading-text">Switching...</span>
        )}
        {errorMsg && (
          <span className="persona-error-text">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
