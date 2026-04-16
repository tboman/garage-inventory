import { useState } from 'react';

export default function PhotoPreview({ photos, onRemove }) {
  const [lightbox, setLightbox] = useState(null);

  return (
    <>
      <div className="photo-upload-grid">
        {photos.map((url, i) => (
          <div key={i} className="photo-upload-thumb">
            <img src={url} alt={`${i + 1}`} onClick={() => setLightbox(url)} />
            {onRemove && (
              <button className="remove-btn" onClick={(e) => { e.stopPropagation(); onRemove(i); }}>
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Full size" />
        </div>
      )}
    </>
  );
}
