import React, { useEffect, useState } from 'react';
import { removePhotoFromItem } from '../api';
import DriveImage from './DriveImage';
import useSwipe from '../useSwipe';

const PhotoGallery = ({ item, onPhotoRemoved, onError }) => {
  // Index into `photos` of the enlarged one, or null when the lightbox is shut.
  const [enlarged, setEnlarged] = useState(null);

  const photos = item.photos || [];
  const count = photos.length;
  const open = enlarged != null && enlarged < count;
  const many = count > 1;

  const step = (delta) => {
    setEnlarged(i => (i == null || count === 0) ? i : (i + delta + count) % count);
  };

  const { dragX, moved, handlers } = useSwipe(step, open && many);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setEnlarged(null);
      else if (count > 1 && e.key === 'ArrowLeft') setEnlarged(i => (i - 1 + count) % count);
      else if (count > 1 && e.key === 'ArrowRight') setEnlarged(i => (i + 1) % count);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, count]);

  if (count === 0) return null;

  const handleDelete = async (photoPath) => {
    try {
      await removePhotoFromItem(item.id, photos, photoPath);
      onPhotoRemoved(item.id, photoPath);
      setEnlarged(null);
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div className="photo-gallery mt-2">
      <div className="d-flex flex-wrap gap-2">
        {photos.map((photo, idx) => (
          <div key={idx} className="photo-thumb position-relative">
            <DriveImage
              src={photo}
              alt={`${item.name} ${idx + 1}`}
              className="rounded"
              style={{ width: 64, height: 64, objectFit: 'cover', cursor: 'pointer' }}
              onClick={() => setEnlarged(idx)}
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

      {open && (
        <div
          className="photo-lightbox"
          // The click that ends a swipe must not also close the lightbox.
          onClick={() => { if (!moved.current) setEnlarged(null); }}
          {...handlers}
        >
          <div
            className={`photo-lightbox-content${dragX ? ' photo-lightbox-dragging' : ''}`}
            style={{ transform: `translateX(${dragX}px)` }}
            onClick={e => e.stopPropagation()}
          >
            <DriveImage
              src={photos[enlarged]}
              alt={`${item.name} ${enlarged + 1}`}
              draggable={false}
            />
            <button
              className="btn btn-light btn-sm photo-lightbox-close"
              onClick={() => setEnlarged(null)}
              title="Close (Esc)"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>

          {many && (
            <>
              <button
                className="photo-viewer-nav photo-viewer-prev"
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                title="Previous (left arrow, or swipe right)"
                aria-label="Previous photo"
              >
                <i className="fas fa-chevron-left"></i>
              </button>
              <button
                className="photo-viewer-nav photo-viewer-next"
                onClick={(e) => { e.stopPropagation(); step(1); }}
                title="Next (right arrow, or swipe left)"
                aria-label="Next photo"
              >
                <i className="fas fa-chevron-right"></i>
              </button>
              <span className="photo-lightbox-count">{enlarged + 1} / {count}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default PhotoGallery;
