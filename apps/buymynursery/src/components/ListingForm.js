import { useState, useRef, useEffect } from 'react';
import PhotoPreview from './PhotoPreview';
import GooglePhotosPickerButton from './GooglePhotosPickerButton';

const conditions = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
];

const categories = [
  { value: 'furniture', label: 'Nursery Furniture' },
  { value: 'gear', label: 'Strollers & Gear' },
  { value: 'clothing', label: 'Baby Clothes (0-5y)' },
  { value: 'toys', label: 'Toys & Books' },
  { value: 'feeding', label: 'Feeding & Nursing' },
  { value: 'safety', label: 'Safety & Health' },
  { value: 'other', label: 'Other' },
];

const platforms = [
  { value: 'ebay', label: 'eBay' },
  { value: 'craigslist', label: 'Craigslist' },
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'offerup', label: 'OfferUp' },
  { value: 'other', label: 'Other' },
];

const MAX_PHOTOS = 10;

export default function ListingForm({
  initial = {},
  onSubmit,
  submitLabel = 'Publish Baby Item',
  loading = false,
  photoUrls: initialPhotoUrls,
}) {
  const [title, setTitle] = useState(initial.title || '');
  const [description, setDescription] = useState(initial.description || '');
  const [priceDollars, setPriceDollars] = useState(initial.price ? (initial.price / 100).toFixed(2) : '');
  const [condition, setCondition] = useState(initial.condition || 'good');
  const [category, setCategory] = useState(initial.category || 'furniture');
  const [externalLinks, setExternalLinks] = useState(initial.externalLinks || []);

  const [existingPhotos, setExistingPhotos] = useState(initialPhotoUrls || initial.photos || []);
  const [newPhotos, setNewPhotos] = useState([]);
  const fileInput = useRef();

  useEffect(() => {
    return () => {
      newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, [newPhotos]);

  const displayPhotos = [...existingPhotos, ...newPhotos.map((p) => p.previewUrl)];

  const handleAddLink = () => {
    setExternalLinks([...externalLinks, { platform: 'ebay', url: '' }]);
  };

  const handleLinkChange = (i, field, value) => {
    const updated = [...externalLinks];
    updated[i] = { ...updated[i], [field]: value };
    setExternalLinks(updated);
  };

  const handleRemoveLink = (i) => {
    setExternalLinks(externalLinks.filter((_, idx) => idx !== i));
  };

  const addFiles = (files) => {
    const remaining = MAX_PHOTOS - displayPhotos.length;
    const toAdd = files.slice(0, remaining).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setNewPhotos((prev) => [...prev, ...toAdd]);
  };

  const handlePhotoSelect = (e) => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleRemovePhoto = (i) => {
    if (i < existingPhotos.length) {
      setExistingPhotos((prev) => prev.filter((_, idx) => idx !== i));
    } else {
      const newIdx = i - existingPhotos.length;
      setNewPhotos((prev) => {
        const removed = prev[newIdx];
        if (removed) URL.revokeObjectURL(removed.previewUrl);
        return prev.filter((_, idx) => idx !== newIdx);
      });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const priceInCents = Math.round(parseFloat(priceDollars) * 100);
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      price: priceInCents,
      currency: 'USD',
      condition,
      category,
      externalLinks: externalLinks.filter((l) => l.url.trim()),
      photoFiles: newPhotos.map((p) => p.file),
      existingPhotos,
    });
  };

  const isValid = title.trim() && priceDollars && parseFloat(priceDollars) > 0 && condition && category;

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label fw-bold">Title</label>
        <input
          type="text"
          className="form-control"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g., Stokke High Chair, Infant Stroller, 0-3m Sleepsuit..."
        />
        <div className="form-text">{title.length}/120</div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-bold">Description</label>
        <textarea
          className="form-control"
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your item's condition, features, and brand..."
        />
        <div className="form-text">{description.length}/2000</div>
      </div>

      <div className="row mb-3">
        <div className="col-sm-4">
          <label className="form-label fw-bold">Price (USD)</label>
          <div className="input-group">
            <span className="input-group-text bg-white border-end-0" style={{color: '#5da9e9'}}>$</span>
            <input
              type="number"
              className="form-control border-start-0"
              min="0.01"
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              required
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="col-sm-4">
          <label className="form-label fw-bold">Condition</label>
          <select className="form-select" value={condition} onChange={(e) => setCondition(e.target.value)}>
            {conditions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="col-sm-4">
          <label className="form-label fw-bold">Category</label>
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label fw-bold">Photos (max {MAX_PHOTOS})</label>
        <div className="p-3 border rounded bg-white mb-2 shadow-sm">
          <PhotoPreview photos={displayPhotos} onRemove={handleRemovePhoto} />
          {displayPhotos.length < MAX_PHOTOS && (
            <div className="d-flex gap-2 mt-2 flex-wrap">
              <button type="button" className="btn btn-nursery btn-sm" onClick={() => fileInput.current.click()}>
                + Upload Files
              </button>
              <GooglePhotosPickerButton onPicked={(files) => addFiles(files)} />
            </div>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={handlePhotoSelect} />
      </div>

      <div className="mb-3">
        <label className="form-label fw-bold">External Links</label>
        <div className="form-text mb-2">Cross-post to your eBay, Craigslist, or other listings</div>
        {externalLinks.map((link, i) => (
          <div key={i} className="input-group mb-2 shadow-sm rounded">
            <select
              className="form-select border-end-0"
              style={{ maxWidth: '160px' }}
              value={link.platform}
              onChange={(e) => handleLinkChange(i, 'platform', e.target.value)}
            >
              {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input
              type="url"
              className="form-control"
              placeholder="https://..."
              value={link.url}
              onChange={(e) => handleLinkChange(i, 'url', e.target.value)}
            />
            <button type="button" className="btn btn-outline-danger" onClick={() => handleRemoveLink(i)}>
              &times;
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill mt-1" onClick={handleAddLink}>
          + Add Listing Link
        </button>
      </div>

      <button type="submit" className="btn btn-nursery btn-lg w-100 mt-3" disabled={!isValid || loading}>
        {loading ? (
          <><span className="spinner-border spinner-border-sm me-2"></span>Publishing...</>
        ) : submitLabel}
      </button>
    </form>
  );
}
