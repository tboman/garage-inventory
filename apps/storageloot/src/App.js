import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import ListingPage from './pages/ListingPage';
import CreateListingPage from './pages/CreateListingPage';
import EditListingPage from './pages/EditListingPage';
import MyListingsPage from './pages/MyListingsPage';
import ImportFromHunaPuka from './pages/ImportFromHunaPuka';
import CreateGroupPage from './pages/CreateGroupPage';
import EditGroupPage from './pages/EditGroupPage';
import GroupPage from './pages/GroupPage';
import MyGroupsPage from './pages/MyGroupsPage';
import EbayAuthCallback from './pages/EbayAuthCallback';
import MyEbayListingsPage from './pages/MyEbayListingsPage';
import AgentAuthorizePage from './pages/AgentAuthorizePage';
import AgentConsentPage from './pages/AgentConsentPage';
import AgentDevicePage from './pages/AgentDevicePage';
import MessagesPage from './pages/MessagesPage';
import ConversationPage from './pages/ConversationPage';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="d-flex flex-column min-vh-100">
          <Navbar />
          <main className="flex-grow-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/listing/:id" element={<ListingPage />} />
              <Route path="/listing/:id/edit" element={<EditListingPage />} />
              <Route path="/create" element={<CreateListingPage />} />
              <Route path="/my-listings" element={<MyListingsPage />} />
              <Route path="/import" element={<ImportFromHunaPuka />} />
              <Route path="/groups/create" element={<CreateGroupPage />} />
              <Route path="/group/:id" element={<GroupPage />} />
              <Route path="/group/:id/edit" element={<EditGroupPage />} />
              <Route path="/my-groups" element={<MyGroupsPage />} />
              <Route path="/ebayAuthCallback" element={<EbayAuthCallback />} />
              <Route path="/my-ebay" element={<MyEbayListingsPage />} />
              <Route path="/authorize" element={<AgentAuthorizePage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:id" element={<ConversationPage />} />
              {/* Personal Agent Protocol sign-in (poppyStorageloot); /authorize above is the MCP consent page. */}
              <Route path="/oauth/authorize" element={<AgentConsentPage />} />
              <Route path="/device" element={<AgentDevicePage />} />
              <Route path="*" element={
                <div className="container py-5 text-center">
                  <h1>404</h1>
                  <p>Page not found.</p>
                </div>
              } />
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
