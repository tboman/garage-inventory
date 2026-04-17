import { useEffect, useState } from 'react';
import GooglePhotosPickerButton from './GooglePhotosPickerButton';

const types = [
  { value: 'container', label: 'Container' },
  { value: 'box', label: 'Box' },
  { value: 'storage', label: 'Storage Unit' },
  { value: 'garage', label: 'Garage' },
  { value: 'custom', label: 'Custom' },
];

const typeImages = {
  container: '/groups/container.svg',
  box: '/groups/box.svg',
  storage: '/groups/storage.svg',
  garage: '/groups/garage.svg',
  custom: '/groups/mystery.svg',
};

export default function GroupForm({ initial = {}, onSubmit, submitLabel = 'Save', loading = false }) {
  const [name, setName] = useState(initial.name || '');
  const [type, setType] = useState(initial.type || 'box');
  const [description, setDescription] = useState(initial.description || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setRemoveExistingPhoto(false);
    }
    e.target.value = '';
  };

  const handleClearPhoto = () => {
    setPhotoFile(null);
    if (initial.photo) setRemoveExistingPhoto(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      type,
      description: description.trim(),
      photoFile,
      removeExistingPhoto,
    });
  };

  const isValid = name.trim().length > 0 && name.trim().length <= 80;

  const existingPhoto = initial.photo && !removeExistingPhoto ? initial.photo : null;
  const displayedImage = photoPreview || existingPhoto || typeImages[type] || typeImages.custom;
  const hasCustomImage = !!(photoPreview || existingPhoto);

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label fw-semibold">Group Name</label>
        <input
          type="text"
          className="form-control"
          maxLength={80}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Garage cleanout, Estate sale box #3"
          required
        />
        <div className="form-text">{name.length}/80</div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold">Type</label>
        <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
          {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="mb-3">
        <label className="form-label fw-semibold">
          Photo <span className="text-muted fw-normal">(optional)</span>
        </label>
        <div className="d-flex align-items-start gap-3">
          <img
            src={displayedImage}
            alt=""
            style={{
              width: 120,
              height: 120,
              objectFit: hasCustomImage ? 'cover' : 'contain',
              borderRadius: '0.375rem',
              background: '#e9ecef',
            }}
          />
          <div className="flex-grow-1">
            <input
              type="file"
              className="form-control form-control-sm"
              accept="image/*"
              onChange={handleFile}
            />
            <div className="form-text">
              {hasCustomImage
                ? 'Upload a new file to replace, or clear to use the default.'
                : 'Optional. Defaults to a stock image based on type.'}
            </div>
            <div className="d-flex gap-2 mt-2 flex-wrap">
              <GooglePhotosPickerButton
                multiple={false}
                onPicked={(files) => {
                  if (files[0]) {
                    setPhotoFile(files[0]);
                    setRemoveExistingPhoto(false);
                  }
                }}
              />
              {hasCustomImage && (
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={handleClearPhoto}
                >
                  Clear photo
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="form-label fw-semibold">
          Description <span className="text-muted fw-normal">(optional)</span>
        </label>
        <textarea
          className="form-control"
          rows={3}
          maxLength={300}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A short description of this group..."
        />
        <div className="form-text">{description.length}/300</div>
      </div>

      <button type="submit" className="btn btn-sl btn-lg w-100" disabled={!isValid || loading}>
        {loading ? (
          <><span className="spinner-border spinner-border-sm me-2"></span>Saving...</>
        ) : submitLabel}
      </button>
    </form>
  );
}
