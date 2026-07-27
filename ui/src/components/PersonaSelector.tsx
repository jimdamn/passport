import { VenetianMask, UserRound, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface PersonaSelectorProps {
  currentPersona: 'anonymous' | 'personal' | 'business';
  businessVerified: boolean;
  onManage: (persona: 'anonymous' | 'personal' | 'business') => void;
}

export function PersonaSelector({
  currentPersona,
  businessVerified,
  onManage,
}: PersonaSelectorProps) {
  const options: {
    type: 'anonymous' | 'personal' | 'business';
    Icon: LucideIcon;
    label: string;
    sub: string;
    disabled: boolean;
    disabledText?: string;
  }[] = [
    {
      type: 'anonymous',
      Icon: VenetianMask,
      label: 'Anonymous',
      sub: 'Posts without revealing your name',
      disabled: false,
    },
    {
      type: 'personal',
      Icon: UserRound,
      label: 'Personal',
      sub: 'Posts as your display name',
      disabled: false,
    },
    {
      type: 'business',
      Icon: Store,
      label: 'Business',
      sub: 'Posts as your business name',
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
          position: relative;
        }
        .persona-card.active {
          background-color: var(--dark, #1e3320);
          color: var(--amber-on-dark, #e8b84b);
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
          line-height: 1.3;
        }
        .persona-disabled-text {
          font-size: 0.7rem;
          color: #a30000;
          margin-top: 6px;
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
          const cardClass = isActive
            ? 'persona-card active'
            : opt.disabled
            ? 'persona-card disabled'
            : 'persona-card inactive';

          return (
            <div
              key={opt.type}
              className={`${cardClass} ${opt.disabled ? 'disabled' : ''}`}
              onClick={() => {
                if (opt.disabled) return;
                onManage(opt.type);
              }}
            >
              {isActive && (
                <span style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'var(--amber)', color: 'var(--white)',
                  fontFamily: 'var(--font-sans)', fontSize: '0.6rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  padding: '2px 6px', borderRadius: 'var(--r-pill)',
                }}>Active</span>
              )}
              <div className="persona-icon"><opt.Icon size={26} strokeWidth={1.75} aria-hidden="true" /></div>
              <div className="persona-details">
                <div className="persona-label">
                  {opt.label}
                </div>
                <div className="persona-sub">
                  {opt.disabled && opt.disabledText ? opt.disabledText : opt.sub}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
