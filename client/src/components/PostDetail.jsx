import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getPost, deletePost } from '../api.js';

function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPost(id)
      .then((res) => setPost(res.data))
      .catch(() => setError('Post not found.'));
  }, [id]);

  const handleDelete = async () => {
    if (!window.confirm('Delete this post?')) return;
    await deletePost(id);
    navigate('/');
  };

  if (error) return <div className="error-banner">{error}</div>;
  if (!post) {
    return (
      <div className="loading-state">
        <span className="spinner" />
        Loading...
      </div>
    );
  }

  return (
    <div className="post-card">
      <h2>{post.title}</h2>
      <div className="meta">
        <span className="avatar">
          {(post.author || 'A').charAt(0).toUpperCase()}
        </span>
        By {post.author || 'Anonymous'} ·{' '}
        {new Date(post.createdAt).toLocaleDateString()}
      </div>
      <p>{post.content}</p>
      <div className="post-actions">
        <Link to={`/edit/${post._id}`} className="btn secondary">
          Edit
        </Link>
        <button className="btn danger" onClick={handleDelete}>
          Delete
        </button>
        <Link to="/" className="btn secondary">
          Back
        </Link>
      </div>
    </div>
  );
}

export default PostDetail;
