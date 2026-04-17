import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getListing, updateListing, removeListingPhoto } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useMyGroups } from '../hooks/useGroups';
import StatusBadge from '../components/StatusBadge';
import ExternalLinks from '../components/ExternalLinks';

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

export default function ListingPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    getListing(id).then(l => {
      setListing(l);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const isOwner = !!user && !!listing && user.uid === listing.sellerId;
  const { groups: myGroups } = useMyGroups(isOwner ? user.uid : null);

  const [groupId, setGroupId] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupMsg, setGroupMsg] = useState(null);
  const [removingPhoto, setRemovingPhoto] = useState(null);

  useEffect(() => {
    setGroupId(listing?.groupId || '');
  }, [listing]);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="container py-5 text-center">
        <h2>Listing not found</h2>
        <Link to="/" className="btn btn-sl mt-3">Browse Listings</Link>
      </div>
    );
  }

  const photos = listing.photos || [];
  const mainPhoto = photos[selectedPhoto] || null;
  const hunapukaUrl = listing.sourceItemId
    ? `https://hunapuka.com/?id=${encodeURIComponent(listing.sourceItemId)}`
    : null;

  const handleSaveGroup = async () => {
    setSavingGroup(true);
    setGroupMsg(null);
    try {
      await updateListing(listing.id, { groupId: groupId || null });
      setListing(prev => ({ ...prev, groupId: groupId || null }));
      setGroupMsg({ type: 'success', text: 'Group updated.' });
    } catch (e) {
      setGroupMsg({ type: 'danger', text: e.message });
    } finally {
      setSavingGroup(false);
    }
  };

  const groupChanged = (listing.groupId || '') !== (groupId || '');

  const handleRemovePhoto = async (url) => {
    if (!window.confirm('Remove this photo from the listing?')) return;
    setRemovingPhoto(url);
    try {
      const remaining = photos.filter(p => p !== url);
      await removeListingPhoto(listing.id, url, remaining);
      setListing(prev => ({ ...prev, photos: remaining }));
      setSelectedPhoto(0);
    } catch (e) {
      alert(`Failed to remove photo: ${e.message}`);
    } finally {
      setRemovingPhoto(null);
    }
  };

  return (
    <div className="container py-4 listing-detail">
      <Link to="/" className="text-decoration-none text-muted mb-3 d-inline-block">&larr; Back to listings</Link>

      <div className="row g-4">
        <div className="col-md-7">
          {mainPhoto ? (
            <img
              src={mainPhoto}
              alt={listing.title}
              className="main-photo w-100 mb-3"
              onClick={() => setLightbox(true)}
              style={{ cursor: 'pointer' }}
            />
          ) : (
            <div className="photo-placeholder rounded mb-3" style={{ height: 400 }}>&#128247;</div>
          )}
          {photos.length > 1 && (
            <div className="photo-gallery">
              {photos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`${i + 1}`}
                  className={i === selectedPhoto ? 'border border-2 border-dark' : ''}
                  onClick={() => setSelectedPhoto(i)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="col-md-5">
          <div className="d-flex align-items-center gap-2 mb-2">
            <StatusBadge status={listing.status} />
          </div>
          <h2 className="fw-bold mb-2">{listing.title}</h2>
          <div className="fs-3 fw-bold text-danger mb-3">{formatPrice(listing.price)}</div>

          <table className="table table-sm">
            <tbody>
              <tr>
                <td className="text-muted">Condition</td>
                <td>{conditionLabels[listing.condition] || listing.condition}</td>
              </tr>
              <tr>
                <td className="text-muted">Category</td>
                <td className="text-capitalize">{listing.category}</td>
              </tr>
              <tr>
                <td className="text-muted">Seller</td>
                <td>{listing.sellerDisplayName}</td>
              </tr>
              {listing.groupId && (
                <tr>
                  <td className="text-muted">Group</td>
                  <td><Link to={`/group/${listing.groupId}`}>View group</Link></td>
                </tr>
              )}
              {listing.createdAt && (
                <tr>
                  <td className="text-muted">Listed</td>
                  <td>{listing.createdAt.toDate?.().toLocaleDateString() || ''}</td>
                </tr>
              )}
            </tbody>
          </table>

          {listing.description && (
            <div className="mb-4">
              <h5 className="fw-semibold">Description</h5>
              <p style={{ whiteSpace: 'pre-wrap' }}>{listing.description}</p>
            </div>
          )}

          {listing.externalLinks?.length > 0 && (
            <div className="mb-4">
              <h5 className="fw-semibold">Buy it on</h5>
              <ExternalLinks links={listing.externalLinks} />
            </div>
          )}

          {isOwner && (
            <div className="border rounded p-3 mb-3 bg-light">
              <h6 className="fw-semibold mb-2">Seller tools</h6>

              {hunapukaUrl && (
                <div className="mb-3">
                  <a href={hunapukaUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline-secondary btn-sm">
                    Open original HunaPuka item &rarr;
                  </a>
                </div>
              )}

              {photos.length > 0 && (
                <div className="mb-3">
                  <label className="form-label fw-semibold small mb-1">Photos</label>
                  <div className="photo-upload-grid">
                    {photos.map(url => (
                      <div key={url} className="photo-upload-thumb">
                        <img src={url} alt="" />
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => handleRemovePhoto(url)}
                          disabled={removingPhoto === url}
                          aria-label="Remove photo"
                          title="Remove photo"
                        >
                          {removingPhoto === url ? '…' : '×'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="form-label fw-semibold small mb-1">Group</label>
              <div className="d-flex gap-2">
                <select
                  className="form-select form-select-sm"
                  value={groupId}
                  onChange={e => setGroupId(e.target.value)}
                  disabled={savingGroup}
                >
                  <option value="">None</option>
                  {myGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button
                  className="btn btn-sl btn-sm"
                  onClick={handleSaveGroup}
                  disabled={!groupChanged || savingGroup}
                >
                  {savingGroup ? 'Saving...' : 'Save'}
                </button>
              </div>
              {groupMsg && (
                <div className={`alert alert-${groupMsg.type} alert-sm py-1 px-2 mt-2 mb-0 small`}>
                  {groupMsg.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {lightbox && mainPhoto && (
        <div className="lightbox-overlay" onClick={() => setLightbox(false)}>
          <img src={mainPhoto} alt={listing.title} />
        </div>
      )}
    </div>
  );
}
