import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPosts, deletePost } from '../api.js';

function PostList() {
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const res = await getPosts();
      setPosts(res.data);
      setError('');
    } catch (err) {
      setError('Could not load posts. Is the backend server running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this post?')) return;
    try {
      await deletePost(id);
      setPosts((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError('Could not delete post.');
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <span className="spinner" />
        Loading posts...
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      {posts.length === 0 && !error ? (
        <div className="empty-state">
          <p>No posts yet.</p>
          <Link to="/new" className="btn">
            Write the first post
          </Link>
        </div>
      ) : (
        <>
          {!error && (
            <div className="posts-toolbar">
              <h2>Latest posts</h2>
              <span className="count">
                {posts.length} {posts.length === 1 ? 'post' : 'posts'}
              </span>
            </div>
          )}
          {posts.map((post) => (
            <div className="post-card" key={post._id}>
              <h2>
                <Link to={`/posts/${post._id}`}>{post.title}</Link>
              </h2>
              <div className="meta">
                <span className="avatar">
                  {(post.author || 'A').charAt(0).toUpperCase()}
                </span>
                By {post.author || 'Anonymous'} ·{' '}
                {new Date(post.createdAt).toLocaleDateString()}
              </div>
              <p>
                {post.content.length > 200
                  ? post.content.slice(0, 200) + '...'
                  : post.content}
              </p>
              <div className="post-actions">
                <Link to={`/edit/${post._id}`} className="btn secondary">
                  Edit
                </Link>
                <button className="btn danger" onClick={() => handleDelete(post._id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default PostList;
