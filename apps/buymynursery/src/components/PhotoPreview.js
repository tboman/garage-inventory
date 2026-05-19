export default function PhotoPreview({ photos, onRemove }) {
  if (!photos || photos.length === 0) return null;

  return (
    <div className="row g-2 mt-2">
      {photos.map((p, i) => (
        <div key={i} className="col-4 col-sm-3 col-md-2 position-relative">
          <img
            src={p}
            alt=""
            className="img-thumbnail w-100"
            style={{ height: '80px', objectFit: 'cover' }}
          />
          <button
            type="button"
            className="btn btn-danger btn-sm position-absolute top-0 end-0 rounded-circle py-0 px-1 m-1"
            onClick={() => onRemove(i)}
            style={{ fontSize: '0.8rem' }}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
