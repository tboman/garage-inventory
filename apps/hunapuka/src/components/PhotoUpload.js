import React, { useState, useRef } from 'react';
import { uploadPhoto, addPhotoToItem } from '../api';

const PhotoUpload = ({ item, onPhotoAdded, onError }) => {
  const [uploading, setUploading] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const { path } = await uploadPhoto(file);
      await addPhotoToItem(item.id, item.photos || [], path);
      onPhotoAdded(item.id, path);
    } catch (err) {
      onError(err.message);
    } finally {
      setUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  return (
    <span className="photo-upload-btn">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <button
        className="btn btn-outline-secondary btn-sm"
        onClick={() => cameraInputRef.current?.click()}
        disabled={uploading}
        title="Take photo"
      >
        {uploading ? (
          <span className="spinner-border spinner-border-sm" role="status"></span>
        ) : (
          <i className="fas fa-camera"></i>
        )}
      </button>
      <button
        className="btn btn-outline-secondary btn-sm ms-1"
        onClick={() => galleryInputRef.current?.click()}
        disabled={uploading}
        title="Choose from gallery"
      >
        <i className="fas fa-images"></i>
      </button>
    </span>
  );
};

export default PhotoUpload;
