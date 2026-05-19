import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ListingForm from '../components/ListingForm';
import { getListing, updateListing, uploadListingPhoto } from '../api';

export default function EditListingPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchListing = async () => {
      try {
        const data = await getListing(id);
        if (!data) throw new Error('Listing not found');
        setListing(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchListing();
  }, [id]);

  if (loading) return <div className="container py-5 text-center"><span className="spinner-border"></span></div>;
  if (!listing) return <div className="container py-5 text-center"><h2>Not found</h2></div>;
  if (user?.uid !== listing.sellerId) return <div className="container py-5 text-center"><h2>Unauthorized</h2></div>;

  const handleSubmit = async (data) => {
    setSubmitting(true);
    setError(null);
    try {
      let finalPhotos = data.existingPhotos;

      if (data.photoFiles && data.photoFiles.length > 0) {
        const newPhotoUrls = await Promise.all(
          data.photoFiles.map((file) => uploadListingPhoto(id, file))
        );
        finalPhotos = [...finalPhotos, ...newPhotoUrls];
      }

      await updateListing(id, {
        ...data,
        photos: finalPhotos,
        existingPhotos: undefined,
        photoFiles: undefined,
      });
      
      navigate(`/listing/${id}`);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h2 className="fw-bold mb-4">Edit listing</h2>
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="card shadow-sm border-0">
            <div className="card-body p-4">
              <ListingForm
                initial={listing}
                onSubmit={handleSubmit}
                loading={submitting}
                submitLabel="Save Changes"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
