import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getAdminMerchants, reviewMerchant } from '../../api/profile';
import { ArrowLeft, CheckCircle, XCircle, Clock, ExternalLink, RefreshCw, Search, Filter, MapPin, Phone, Globe } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

export default function AdminMerchants() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [merchants, setMerchants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/auth/login');
      return;
    }
    if (!user.is_admin) {
      navigate('/profile');
      return;
    }
    fetchMerchants();
  }, [user]);

  const fetchMerchants = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminMerchants();
      setMerchants(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load merchant applications.');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (id: number, status: 'verified' | 'rejected' | 'pending') => {
    if (processingId !== null) return;
    setProcessingId(id);
    setError('');
    try {
      await reviewMerchant(id, status);
      // Update local state dynamically
      setMerchants(prev =>
        prev.map(m => (m.id === id ? { ...m, verification_status: status } : m))
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update merchant status.');
    } finally {
      setProcessingId(null);
    }
  };

  const filtered = merchants.filter(m => {
    const matchesStatus = filterStatus === 'all' || m.verification_status === filterStatus;
    const searchStr = `${m.name} ${m.email || ''} ${m.category} ${m.zip || ''}`.toLowerCase();
    const matchesSearch = searchStr.includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  if (loading) {
    return (
      <div className="main-content" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Spinner size="lg" />
        <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.85rem' }}>Loading applications...</p>
      </div>
    );
  }

  return (
    <div className="main-content" style={{ maxWidth: 800, margin: '0 auto', paddingTop: 20, paddingBottom: 80 }}>
      {/* Back button */}
      <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontFamily: 'var(--font-serif)', color: 'var(--green)' }}>
            Merchant Directory Admin
          </h1>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)' }}>
            Review, approve, or deny local business applications
          </p>
        </div>
        <button 
          onClick={fetchMerchants} 
          className="btn btn-secondary btn-sm" 
          style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34 }}
          title="Refresh Applications"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: 16, marginBottom: 20, background: 'var(--white)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search by business name, owner email, zip..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ paddingLeft: 34, minHeight: 36, margin: 0 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Filter size={14} style={{ color: 'var(--muted)' }} />
          <select
            className="form-select"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ minHeight: 36, margin: 0, fontSize: '0.82rem' }}
          >
            <option value="all">All Applications</option>
            <option value="pending">Pending Review</option>
            <option value="verified">Verified Merchants</option>
            <option value="rejected">Declined Applications</option>
          </select>
        </div>
      </div>

      {/* Applications list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filtered.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', background: 'var(--white)' }}>
            <p style={{ margin: 0, color: 'var(--muted)' }}>No applications found matching the criteria.</p>
          </div>
        ) : (
          filtered.map(m => {
            const isPending = m.verification_status === 'pending';
            const isVerified = m.verification_status === 'verified';
            const isRejected = m.verification_status === 'rejected';

            return (
              <div 
                key={m.id} 
                className="card" 
                style={{ 
                  background: 'var(--white)', 
                  padding: 20, 
                  borderLeft: `4px solid ${
                    isVerified ? 'var(--green)' : isRejected ? 'var(--error)' : 'var(--amber)'
                  }`,
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'transform 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--green)', fontWeight: 600 }}>
                        {m.name}
                      </h3>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        padding: '2px 6px',
                        borderRadius: 'var(--r-sm)',
                        background: isVerified ? 'rgba(30, 51, 32, 0.08)' : isRejected ? 'rgba(176, 0, 0, 0.08)' : 'rgba(200, 134, 10, 0.08)',
                        color: isVerified ? 'var(--green)' : isRejected ? 'var(--error)' : 'var(--amber)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4
                      }}>
                        {isVerified && <CheckCircle size={10} />}
                        {isRejected && <XCircle size={10} />}
                        {isPending && <Clock size={10} />}
                        {m.verification_status}
                      </span>
                    </div>

                    <p style={{ margin: '0 0 8px', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      Category: <strong style={{ textTransform: 'capitalize' }}>{m.category}</strong> &middot; Owner Email: <strong>{m.email}</strong>
                    </p>

                    {m.description && (
                      <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.45, background: 'rgba(0,0,0,0.02)', padding: '8px 12px', borderRadius: 'var(--r-sm)' }}>
                        {m.description}
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {m.address && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} aria-hidden="true" /> {m.address}{m.zip ? `, ${m.zip}` : ''}</span>}
                      {!m.address && m.zip && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} aria-hidden="true" /> ZIP: {m.zip}</span>}
                      {m.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={12} aria-hidden="true" /> {m.phone}</span>}
                      {m.website && (
                        <a href={m.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                          <Globe size={12} aria-hidden="true" /> Website <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignSelf: 'center' }}>
                    {isPending ? (
                      <>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleReview(m.id, 'rejected')}
                          disabled={processingId !== null}
                          style={{ minHeight: 34, borderColor: 'var(--error)', color: 'var(--error)', background: 'none' }}
                        >
                          Deny
                        </button>
                        <button
                          className="btn btn-amber btn-sm"
                          onClick={() => handleReview(m.id, 'verified')}
                          disabled={processingId !== null}
                          style={{ minHeight: 34 }}
                        >
                          {processingId === m.id ? 'Approving...' : 'Approve'}
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleReview(m.id, 'pending')}
                        disabled={processingId !== null}
                        style={{ minHeight: 34, opacity: 0.6 }}
                      >
                        Reset to Pending
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
