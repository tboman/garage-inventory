import React, { useState } from 'react';
import { removePhotoFromItem } from '../api';

const PhotoGallery = ({ item, onPhotoRemoved, onError }) => {
  const [enlarged, setEnlarged] = useState(null);

  const photos = item.photos || [];
  if (photos.length === 0) return null;

  const handleDelete = async (photoPath) => {
    try {
      await removePhotoFromItem(item.id, photos, photoPath);
      onPhotoRemoved(item.id, photoPath);
      if (enlarged === photoPath) setEnlarged(null);
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div className="photo-gallery mt-2">
      <div className="d-flex flex-wrap gap-2">
        {photos.map((photo, idx) => (
          <div key={idx} className="photo-thumb position-relative">
            <img
              src={photo}
              alt={`${item.name} ${idx + 1}`}
              className="rounded"
              style={{ width: 64, height: 64, objectFit: 'cover', cursor: 'pointer' }}
              onClick={() => setEnlarged(photo)}
            />
            <button
              className="btn btn-danger btn-sm photo-delete-btn"
              onClick={() => handleDelete(photo)}
              title="Remove photo"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        ))}
      </div>

      {enlarged && (
        <div className="photo-lightbox" onClick={() => setEnlarged(null)}>
          <div className="photo-lightbox-content" onClick={e => e.stopPropagation()}>
            <img src={enlarged} alt="Enlarged" />
            <button
              className="btn btn-light btn-sm photo-lightbox-close"
              onClick={() => setEnlarged(null)}
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoGallery;
