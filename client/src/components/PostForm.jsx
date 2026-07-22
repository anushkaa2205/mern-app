import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPost, getPost, updatePost } from '../api.js';

function PostForm({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode === 'edit' && id) {
      getPost(id).then((res) => {
        setTitle(res.data.title);
        setContent(res.data.content);
        setAuthor(res.data.author || '');
      });
    }
  }, [mode, id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required.');
      return;
    }
    try {
      const payload = { title, content, author };
      if (mode === 'edit') {
        await updatePost(id, payload);
        navigate(`/posts/${id}`);
      } else {
        const res = await createPost(payload);
        navigate(`/posts/${res.data._id}`);
      }
    } catch (err) {
      setError('Could not save post.');
    }
  };

  return (
    <form className="post-form" onSubmit={handleSubmit}>
      <h2>{mode === 'edit' ? 'Edit Post' : 'New Post'}</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          placeholder="Give your post a title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="author">Author</label>
        <input
          id="author"
          type="text"
          placeholder="Your name (optional)"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="content">Content</label>
        <textarea
          id="content"
          placeholder="Write your post..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn">
          {mode === 'edit' ? 'Save Changes' : 'Publish'}
        </button>
      </div>
    </form>
  );
}

export default PostForm;
