import React, { useState } from 'react';

const AddItemForm = ({ items, onAddItem }) => {
  const [itemName, setItemName] = useState('');
  const [itemLocation, setItemLocation] = useState('');
  const [itemDescription, setItemDescription] = useState('');

  const getIndentedOptions = (items, parentId = null, indent = 0) => {
    const options = [];
    const directChildren = items
      .filter(item => item.locationId === parentId)
      .sort((a, b) => a.order - b.order);

    directChildren.forEach(item => {
      options.push({ id: item.id, name: '\u2003'.repeat(indent) + item.name });
      options.push(...getIndentedOptions(items, item.id, indent + 1));
    });
    return options;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const locationId = itemLocation || null;
    onAddItem({ name: itemName, locationId, description: itemDescription });
    setItemName('');
    setItemDescription('');
  };

  const indentedOptions = getIndentedOptions(items);

  return (
    <form onSubmit={handleSubmit} className="add-item-form mb-4">
      <div className="row g-2">
        <div className="col-12 col-md-6">
          <select
            className="form-select"
            value={itemLocation}
            onChange={e => setItemLocation(e.target.value)}
          >
            <option value="">-- Root level --</option>
            {indentedOptions.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-6">
          <input
            type="text"
            className="form-control"
            placeholder="Item name"
            value={itemName}
            onChange={e => setItemName(e.target.value)}
            required
          />
        </div>
        <div className="col-12">
          <textarea
            className="form-control"
            placeholder="Description (optional)"
            value={itemDescription}
            onChange={e => setItemDescription(e.target.value)}
            rows="2"
          />
        </div>
        <div className="col-12">
          <button type="submit" className="btn btn-primary w-100">
            <i className="fas fa-plus me-2"></i>Add Item
          </button>
        </div>
      </div>
    </form>
  );
};

export default AddItemForm;
