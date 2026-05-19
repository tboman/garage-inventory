import { useState } from 'react';
import { pickGooglePhotos } from '../googlePhotosPicker';

export default function GooglePhotosPickerButton({ onPicked }) {
  const [loading, setLoading] = useState(false);

  const handlePick = async () => {
    setLoading(true);
    try {
      const files = await pickGooglePhotos();
      if (files.length > 0) {
        onPicked(files);
      }
    } catch (e) {
      if (e.message !== 'Cancelled.') {
        alert(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className="btn btn-outline-primary btn-sm d-flex align-items-center gap-2"
      onClick={handlePick}
      disabled={loading}
    >
      {loading ? (
        <span className="spinner-border spinner-border-sm"></span>
      ) : (
        <span style={{fontSize: '1.2rem'}}>📷</span>
      )}
      Pick from Google Photos
    </button>
  );
}
