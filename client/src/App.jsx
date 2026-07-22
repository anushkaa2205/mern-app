import { Routes, Route, Link } from 'react-router-dom';
import PostList from './components/PostList.jsx';
import PostForm from './components/PostForm.jsx';
import PostDetail from './components/PostDetail.jsx';

function App() {
  return (
    <div>
      <header className="site-header">
        <Link to="/" className="brand">
          <h1>MERN Blog</h1>
          <span className="tagline">Thoughts, stories &amp; ideas</span>
        </Link>
        <Link to="/new" className="btn">
          New Post
        </Link>
      </header>
      <div className="container">
        <Routes>
          <Route path="/" element={<PostList />} />
          <Route path="/new" element={<PostForm mode="create" />} />
          <Route path="/edit/:id" element={<PostForm mode="edit" />} />
          <Route path="/posts/:id" element={<PostDetail />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
