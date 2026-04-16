import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { createListing, uploadListingPhoto } from '../api';
import ListingForm from '../components/ListingForm';

export default function CreateListingPage() {
  const { user, login, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  if (authLoading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to sell</h2>
        <p className="text-muted">You need a Google account to list items on StorageLoot.</p>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  const handleSubmit = async (data) => {
    setPublishing(true);
    setError(null);
    try {
      // Create listing first to get ID for photo storage path
      const listingId = await createListing({
        title: data.title,
        description: data.description,
        price: data.price,
        currency: data.currency,
        condition: data.condition,
        category: data.category,
        externalLinks: data.externalLinks,
        photos: [],
      }, user);

      // Upload photos
      if (data.photoFiles.length > 0) {
        const photoUrls = [];
        for (const file of data.photoFiles) {
          const url = await uploadListingPhoto(listingId, file);
          photoUrls.push(url);
        }
        // Update listing with photo URLs
        const { updateListing } = await import('../api');
        await updateListing(listingId, { photos: photoUrls });
      }

      navigate(`/listing/${listingId}`);
    } catch (e) {
      setError(e.message);
      setPublishing(false);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 700 }}>
      <h2 className="fw-bold mb-4">Create Listing</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      <ListingForm onSubmit={handleSubmit} loading={publishing} />
    </div>
  );
}
