import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMyGroups } from '../hooks/useGroups';
import {
  getListing,
  updateListing,
  uploadListingPhoto,
  deleteListingPhotoFromStorage,
  generateKeywords,
} from '../api';
import ListingForm from '../components/ListingForm';

export default function EditListingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, login, loading: authLoading } = useAuth();
  const { groups: myGroups } = useMyGroups(user?.uid);

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getListing(id)
      .then((l) => {
        if (!cancelled) {
          setListing(l);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [id]);

  if (authLoading || loading) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" role="status" /></div>;
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to edit listings</h2>
        <button className="btn btn-sl btn-lg mt-3" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="container py-5 text-center">
        <h2>Listing not found</h2>
        <Link to="/my-listings" className="btn btn-sl mt-3">Back to My Listings</Link>
      </div>
    );
  }

  if (listing.sellerId !== user.uid) {
    return (
      <div className="container py-5 text-center">
        <h2>You can't edit this listing</h2>
        <p className="text-muted">Only the seller can edit a listing.</p>
        <Link to={`/listing/${listing.id}`} className="btn btn-sl mt-3">Back to listing</Link>
      </div>
    );
  }

  const handleSubmit = async (data) => {
    setSaving(true);
    setError(null);
    try {
      const uploadedUrls = [];
      for (const file of data.photoFiles) {
        const url = await uploadListingPhoto(listing.id, file);
        uploadedUrls.push(url);
      }

      const finalPhotos = [...data.existingPhotos, ...uploadedUrls];

      await updateListing(listing.id, {
        title: data.title,
        description: data.description,
        price: data.price,
        currency: data.currency,
        condition: data.condition,
        category: data.category,
        groupId: data.groupId,
        externalLinks: data.externalLinks,
        photos: finalPhotos,
        titleLower: data.title.toLowerCase(),
        keywords: generateKeywords(data.title),
      });

      const removedUrls = (listing.photos || []).filter((u) => !data.existingPhotos.includes(u));
      await Promise.all(removedUrls.map((u) => deleteListingPhotoFromStorage(u)));

      navigate(`/listing/${listing.id}`);
    } catch (e) {
      setError(e.message || 'Failed to save listing.');
      setSaving(false);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 700 }}>
      <Link to={`/listing/${listing.id}`} className="text-decoration-none text-muted mb-3 d-inline-block">
        &larr; Back to listing
      </Link>
      <h2 className="fw-bold mb-4">Edit Listing</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      <ListingForm
        initial={listing}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
        loading={saving}
        myGroups={myGroups}
      />
    </div>
  );
}
