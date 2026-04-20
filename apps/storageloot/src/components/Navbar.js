import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useEbayIntegration } from '../hooks/useEbayIntegration';
import { startEbayLogin } from '../ebayAuth';

export default function Navbar() {
  const { user, login, logout } = useAuth();
  const { integration: ebay, unlink: unlinkEbay } = useEbayIntegration();

  return (
    <nav className="navbar navbar-expand-md sl-navbar navbar-dark">
      <div className="container">
        <Link className="navbar-brand" to="/">StorageLoot</Link>
        <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
          <div className="d-flex align-items-center gap-2 ms-auto flex-wrap">
            {user ? (
              <>
                <span className="text-light small d-none d-md-inline">
                  {user.displayName || user.email}
                </span>
                <Link className="nav-link px-2" to="/my-groups">My Groups</Link>
                <Link className="nav-link px-2" to="/my-listings">My Listings</Link>
                {ebay && <Link className="nav-link px-2" to="/my-ebay">My eBay</Link>}
                {ebay ? (
                  <span className="d-flex align-items-center gap-1">
                    <span className="badge bg-light text-dark">eBay: @{ebay.username}</span>
                    <button
                      className="btn btn-sm btn-link text-light p-0"
                      onClick={unlinkEbay}
                      title="Disconnect eBay"
                    >
                      Disconnect
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-outline-light btn-sm" onClick={() => startEbayLogin()}>
                    Connect eBay
                  </button>
                )}
                <button className="btn btn-outline-light btn-sm" onClick={logout}>
                  Sign Out
                </button>
              </>
            ) : (
              <button className="btn btn-outline-light btn-sm" onClick={login}>
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
