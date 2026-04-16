import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../hooks/useAuth';
import { functions } from '../firebase';
import ListingForm from '../components/ListingForm';

export default function ImportFromHunaPuka() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, login, loading: authLoading } = useAuth();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');

  const title = searchParams.get('title') || '';
  const description = searchParams.get('description') || '';
  const sourceItemId = searchParams.get('sourceItemId') || null;

  let drivePhotos = [];
  try {
    drivePhotos = JSON.parse(searchParams.get('photos') || '[]');
  } catch {
    drivePhotos = [];
  }

  // Get Google access token from the auth flow for Drive API access
  const [accessToken, setAccessToken] = useState(null);
  useEffect(() => {
    if (user) {
      const token = sessionStorage.getItem('google_access_token');
      setAccessToken(token);
    }
  }, [user]);

  if (authLoading) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>;
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to import from HunaPuka</h2>
        <p className="text-muted">Sign in with the same Google account you use on HunaPuka.</p>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  const handleSubmit = async (data) => {
    setPublishing(true);
    setError(null);
    setStatus('Copying photos from Google Drive...');

    try {
      const exportListing = httpsCallable(functions, 'exportListing');
      const result = await exportListing({
        title: data.title,
        description: data.description,
        price: data.price,
        currency: data.currency || 'USD',
        condition: data.condition,
        category: data.category,
        externalLinks: data.externalLinks,
        drivePhotoUrls: drivePhotos,
        accessToken,
        sourceItemId,
      });

      setStatus('Done!');
      navigate(`/listing/${result.data.listingId}`);
    } catch (e) {
      setError(e.message);
      setPublishing(false);
      setStatus('');
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 700 }}>
      <h2 className="fw-bold mb-1">Import from HunaPuka</h2>
      <p className="text-muted mb-4">Your item details have been imported. Add pricing and details to publish.</p>

      {error && <div className="alert alert-danger">{error}</div>}
      {status && <div className="alert alert-info">{status}</div>}

      <ListingForm
        initial={{ title, description, sourceItemId }}
        photoUrls={drivePhotos}
        onSubmit={handleSubmit}
        loading={publishing}
        submitLabel="Publish to StorageLoot"
      />
    </div>
  );
}
