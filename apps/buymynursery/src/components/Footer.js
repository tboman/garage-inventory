export default function Footer() {
  return (
    <footer className="bg-white py-5 mt-auto border-top">
      <div className="container">
        <div className="row g-4">
          <div className="col-md-6">
            <h5 className="fw-bold mb-3" style={{color: '#5da9e9'}}>🧸 Buy My Nursery</h5>
            <p className="text-muted small mb-0" style={{maxWidth: '400px', lineHeight: '1.6'}}>
              A community-driven marketplace dedicated to giving nursery furniture, 
              clothing, and toys a second life. We help parents find quality 
              items for their little ones (0-5 years) while reducing waste.
            </p>
          </div>
          <div className="col-md-3">
            <h6 className="fw-bold mb-3">Community</h6>
            <ul className="list-unstyled small">
              <li className="mb-2"><a href="/" className="text-decoration-none text-muted">Shop Items</a></li>
              <li className="mb-2"><a href="/create" className="text-decoration-none text-muted">Start Selling</a></li>
              <li className="mb-2"><a href="/my-listings" className="text-decoration-none text-muted">Your Shop</a></li>
            </ul>
          </div>
          <div className="col-md-3">
            <h6 className="fw-bold mb-3">Contact</h6>
            <ul className="list-unstyled small">
              <li className="mb-2"><span className="text-muted">Email: hello@buymynursery.com</span></li>
              <li className="mb-2"><span className="text-muted">Hours: 24/7 Shopping</span></li>
            </ul>
          </div>
        </div>
        <hr className="my-5 opacity-10" />
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-center gap-3">
          <div className="text-muted small">
            &copy; {new Date().getFullYear()} Buy My Nursery. Made for little explorers.
          </div>
          <div className="d-flex gap-4">
            <span className="text-muted" style={{fontSize: '1.2rem'}}>🍼</span>
            <span className="text-muted" style={{fontSize: '1.2rem'}}>🛏️</span>
            <span className="text-muted" style={{fontSize: '1.2rem'}}>👶</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
