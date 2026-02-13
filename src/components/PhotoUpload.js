import React, { useState, useRef } from 'react';
import { uploadPhoto, addPhotoToItem } from '../api';

const PhotoUpload = ({ item, onPhotoAdded, onError }) => {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const { path } = await uploadPhoto(file);
      // Re-read current photos from item at call time to avoid race condition;
      // the API will PATCH with the full array, so the latest state matters.
      // The parent's onPhotoAdded uses the functional updater so local state stays correct.
      await addPhotoToItem(item.id, item.photos || [], path);
      onPhotoAdded(item.id, path);
    } catch (err) {
      onError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <span className="photo-upload-btn">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <button
        className="btn btn-outline-secondary btn-sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title="Add photo"
      >
        {uploading ? (
          <span className="spinner-border spinner-border-sm" role="status"></span>
        ) : (
          <i className="fas fa-camera"></i>
        )}
      </button>
    </span>
  );
};

export default PhotoUpload;
