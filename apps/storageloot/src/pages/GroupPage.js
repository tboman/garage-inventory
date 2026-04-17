import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getGroup, getListingsByGroup } from '../api';
import { useAuth } from '../hooks/useAuth';
import ListingGrid from '../components/ListingGrid';

const typeLabels = {
  container: 'Container',
  box: 'Box',
  storage: 'Storage Unit',
  garage: 'Garage',
  custom: 'Custom',
};

const typeImages = {
  container: '/groups/container.svg',
  box: '/groups/box.svg',
  storage: '/groups/storage.svg',
  garage: '/groups/garage.svg',
  custom: '/groups/mystery.svg',
};

export default function GroupPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [g, l] = await Promise.all([getGroup(id), getListingsByGroup(id)]);
        if (!active) return;
        setGroup(g);
        setListings(l);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (error) {
    return <div className="container py-5"><div className="alert alert-danger">{error}</div></div>;
  }

  if (!group) {
    return (
      <div className="container py-5 text-center">
        <h2>Group not found</h2>
        <Link to="/" className="btn btn-sl mt-3">Back to home</Link>
      </div>
    );
  }

  const image = typeImages[group.type] || typeImages.custom;
  const label = typeLabels[group.type] || 'Custom';
  const isOwner = !!user && user.uid === group.ownerId;

  return (
    <div className="container py-4">
      <div className="row align-items-center mb-4">
        <div className="col-sm-4 mb-3 mb-sm-0">
          <img src={image} alt={label} className="img-fluid rounded" />
        </div>
        <div className="col-sm-8">
          <div className="d-flex justify-content-between align-items-start">
            <h1 className="fw-bold mb-1">{group.name}</h1>
            {isOwner && (
              <Link to={`/group/${group.id}/edit`} className="btn btn-outline-secondary btn-sm">
                Edit
              </Link>
            )}
          </div>
          <div className="mb-2">
            <span className="badge bg-light text-dark border">{label}</span>
          </div>
          <div className="text-muted">by {group.ownerDisplayName || 'Anonymous'}</div>
          <div className="text-muted small">{listings.length} item{listings.length === 1 ? '' : 's'}</div>
          {group.description && (
            <p className="mt-2 mb-0" style={{ whiteSpace: 'pre-wrap' }}>{group.description}</p>
          )}
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="fw-bold mb-0">Items in this group</h3>
        {isOwner && (
          <Link to={`/create?groupId=${group.id}`} className="btn btn-sl btn-sm">+ Add Item</Link>
        )}
      </div>
      <ListingGrid listings={listings} />
    </div>
  );
}
