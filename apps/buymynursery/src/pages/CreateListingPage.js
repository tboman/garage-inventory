import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ListingForm from '../components/ListingForm';
import { createListing, uploadListingPhoto, updateListing } from '../api';

export default function CreateListingPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2 className="fw-bold mb-4">Sign in to post a listing</h2>
        <button className="btn btn-nursery btn-lg" onClick={login}>
          Sign in with Google
        </button>
      </div>
    );
  }

  const handleSubmit = async (data) => {
    setLoading(true);
    setError(null);
    try {
      const id = await createListing(data, user);
      
      if (data.photoFiles && data.photoFiles.length > 0) {
        const photoUrls = await Promise.all(
          data.photoFiles.map((file) => uploadListingPhoto(id, file))
        );
        await updateListing(id, { photos: photoUrls });
      }
      
      navigate(`/listing/${id}`);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h2 className="fw-bold mb-4">Post a new listing</h2>
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="card shadow-sm border-0">
            <div className="card-body p-4">
              <ListingForm onSubmit={handleSubmit} loading={loading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
