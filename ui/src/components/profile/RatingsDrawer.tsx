import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMemberRatings, submitRating } from '../../api/profile';
import { Spinner } from '../ui/Spinner';
import { formatDate } from '../../utils/dates';
import type { Review } from '../../types';

export type RatingsDrawerView = 'rating' | 'reviews';

interface Props {
  open:           boolean;
  onClose:        () => void;
  view:           RatingsDrawerView;
  memberId:       string;
  memberName:     string;
  tenantId:       string;
  currentUserId?: string;
  isOwnProfile?:  boolean;
}

function Stars({ score, size = 16 }: { score: number; size?: number }) {
  return (
    <span aria-label={`${score} out of 5 stars`} style={{ fontSize: size, letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} style={{ color: i <= score ? 'var(--amber)' : 'var(--border)' }}>★</span>
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(i)}
          aria-label={`${i} star${i !== 1 ? 's' : ''}`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '2rem', lineHeight: 1, padding: '2px 4px',
            color: i <= (hovered || value) ? 'var(--amber)' : 'var(--border)',
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--font-sans)', fontSize: '0.78rem', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      color: 'var(--muted)', marginBottom: 10,
    }}>
      {children}
    </p>
  );
}

// ── Rating view — average + star breakdown ────────────────────────────────────

function RatingContent({ ratings, rating_avg, rating_count }: {
  ratings: Review[];
  rating_avg: number;
  rating_count: number;
}) {
  const breakdown = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: ratings.filter(r => r.score === star).length,
  }));
  const maxCount = Math.max(...breakdown.map(b => b.count), 1);

  return (
    <>
      {/* Average hero */}
      <div style={{
        background: 'rgba(200,134,10,0.07)', border: '1px solid var(--amber)',
        borderRadius: 'var(--r-md)', padding: '20px 16px', marginBottom: 20,
        textAlign: 'center',
      }}>
        {rating_count > 0 ? (
          <>
            <div style={{
              fontFamily: 'var(--font-serif)', fontSize: '2.8rem',
              fontWeight: 'bold', color: 'var(--amber)', lineHeight: 1,
            }}>
              {rating_avg.toFixed(1)}
            </div>
            <div style={{ marginTop: 6 }}>
              <Stars score={Math.round(rating_avg)} size={20} />
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: '0.75rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--muted)', marginTop: 6,
            }}>
              {rating_count} rating{rating_count !== 1 ? 's' : ''}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.875rem', color: 'var(--muted)', padding: '8px 0' }}>
            No ratings yet
          </div>
        )}
      </div>

      {/* Star breakdown */}
      {rating_count > 0 && (
        <>
          <SectionLabel>Breakdown</SectionLabel>
          {breakdown.map(b => (
            <div key={b.star} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--amber)', width: 20, textAlign: 'right', flexShrink: 0 }}>
                {b.star}★
              </span>
              <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${(b.count / maxCount) * 100}%`,
                  height: '100%', background: 'var(--amber)', borderRadius: 4,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--muted)', width: 20, flexShrink: 0 }}>
                {b.count}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ── Reviews view — written comments ──────────────────────────────────────────

function ReviewsContent({ ratings, isOwnProfile }: { ratings: Review[]; isOwnProfile?: boolean }) {
  const reviews = ratings.filter(r => r.comment);

  if (reviews.length === 0) {
    return (
      <p style={{
        fontFamily: 'var(--font-sans)', fontSize: '0.875rem',
        color: 'var(--muted)', textAlign: 'center', padding: '20px 0',
      }}>
        {isOwnProfile ? "You haven't received any written reviews yet." : 'No written reviews yet.'}
      </p>
    );
  }

  return (
    <>
      <SectionLabel>Written Reviews</SectionLabel>
      {reviews.map(r => (
        <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--green)' }}>
              {r.rater_display_name ?? 'A Member'}
            </span>
            <Stars score={r.score} size={14} />
          </div>
          <p style={{ margin: '4px 0', fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: 'var(--green)', lineHeight: 1.45 }}>
            {r.comment}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.72rem', color: 'var(--muted)' }}>
              {formatDate(r.created_at)}
            </span>
            {r.context_type && (
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.72rem', color: 'var(--sage)' }}>
                · {r.context_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RatingsDrawer({
  open, onClose, view, memberId, memberName, tenantId, currentUserId, isOwnProfile,
}: Props) {
  const queryClient = useQueryClient();
  const [showForm,  setShowForm]  = useState(false);
  const [score,     setScore]     = useState(0);
  const [comment,   setComment]   = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShowForm(false);
      setScore(0);
      setComment('');
      setFormError(null);
      setSubmitted(false);
    }
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['ratings', tenantId, memberId],
    queryFn:  () => getMemberRatings(tenantId, memberId, 50),
    enabled:  open && !!memberId && !!tenantId,
  });

  const mutation = useMutation({
    mutationFn: () => submitRating(tenantId, memberId, score, comment || null),
    onSuccess: () => {
      setSubmitted(true);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['ratings', tenantId, memberId] });
      queryClient.invalidateQueries({ queryKey: ['member',  tenantId, memberId] });
    },
    onError: (err: any) => {
      setFormError(err.message ?? 'Failed to submit. Please try again.');
    },
  });

  const ratings: Review[] = data?.data?.ratings      ?? [];
  const rating_avg        = data?.data?.rating_avg   ?? 0;
  const rating_count      = data?.data?.rating_count ?? 0;
  const canRate           = !isOwnProfile && !!currentUserId && !submitted;

  const title = view === 'rating'
    ? (isOwnProfile ? 'My Rating'  : `${memberName}'s Rating`)
    : (isOwnProfile ? 'My Reviews' : `${memberName}'s Reviews`);

  const submitLabel = view === 'rating' ? 'Leave a Rating' : 'Leave a Review';
  const commentPlaceholder = view === 'rating'
    ? 'Add a comment (optional)'
    : 'Share your experience (required for reviews)';

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 200, display: open ? 'block' : 'none',
        }}
      />

      {/* Slide-in panel — from the LEFT */}
      <aside
        aria-label={title}
        aria-hidden={!open}
        {...(!open ? { inert: '' } : {})}
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 'min(400px, 100vw)', background: 'var(--cream)',
          zIndex: 201, display: 'flex', flexDirection: 'column',
          paddingTop:    'max(16px, env(safe-area-inset-top))',
          paddingLeft:   'max(16px, env(safe-area-inset-left))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          paddingRight:  '16px',
          overflowY: 'auto',
          transform:  open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexShrink: 0 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--green)', width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--r-sm)', flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
          <h2 style={{
            fontFamily: 'var(--font-serif)', fontSize: '1.15rem',
            fontWeight: 'bold', color: 'var(--green)', margin: 0,
          }}>
            {title}
          </h2>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <Spinner size="md" />
          </div>
        )}

        {!isLoading && open && (
          <>
            {/* View-specific content */}
            {view === 'rating' && (
              <RatingContent ratings={ratings} rating_avg={rating_avg} rating_count={rating_count} />
            )}
            {view === 'reviews' && (
              <ReviewsContent ratings={ratings} isOwnProfile={isOwnProfile} />
            )}

            {/* Submit button */}
            {canRate && !showForm && (
              <button
                className="btn btn-amber btn-sm"
                onClick={() => setShowForm(true)}
                style={{ marginTop: 20 }}
              >
                {submitLabel}
              </button>
            )}

            {/* Success confirmation */}
            {submitted && (
              <div style={{
                background: 'rgba(80,120,80,0.1)', border: '1px solid var(--sage)',
                borderRadius: 'var(--r-sm)', padding: '12px 14px', marginTop: 20,
                fontFamily: 'var(--font-sans)', fontSize: '0.875rem', color: 'var(--green)',
              }}>
                ✓ Submitted successfully.
              </div>
            )}

            {/* Submission form */}
            {showForm && (
              <div style={{
                background: 'rgba(30,51,32,0.04)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', padding: '16px', marginTop: 20,
              }}>
                <p style={{
                  margin: '0 0 12px', fontFamily: 'var(--font-sans)',
                  fontWeight: 700, fontSize: '0.875rem', color: 'var(--green)',
                }}>
                  Rate {memberName}
                </p>

                <StarPicker value={score} onChange={setScore} />

                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder={commentPlaceholder}
                  maxLength={500}
                  rows={3}
                  style={{
                    width: '100%', marginTop: 12, padding: '10px 12px',
                    fontFamily: 'var(--font-sans)', fontSize: '0.875rem',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                    background: 'white', resize: 'vertical', boxSizing: 'border-box',
                    color: 'var(--green)',
                  }}
                />

                {formError && (
                  <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--error)' }}>
                    {formError}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (score < 1) { setFormError('Please select a star rating.'); return; }
                      setFormError(null);
                      mutation.mutate();
                    }}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? 'Submitting…' : 'Submit'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowForm(false); setFormError(null); }}
                    disabled={mutation.isPending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
