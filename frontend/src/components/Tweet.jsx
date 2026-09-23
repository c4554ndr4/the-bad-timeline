import './Tweet.css'
import { useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import api from '../lib/api'

function Tweet({ tweet, onLike }) {
  const [isLiked, setIsLiked] = useState(false)
  const [likes, setLikes] = useState(tweet.likes)

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'now'
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    return `${diffDays}d`
  }

  const handleLike = async () => {
    if (!isSupabaseConfigured) {
      alert('Configure Supabase to like tweets.')
      return
    }

    try {
      const config = {}
      if (isSupabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          config.headers = {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      }
      
      await api.post(`/api/tweets/${tweet.id}/like`, {}, config)
      setIsLiked(true)
      setLikes(prev => prev + 1)
      onLike(tweet.id)
    } catch (error) {
      console.error('Error liking tweet:', error)
      if (error.response?.status === 401) {
        alert('Please log in to like tweets')
      } else {
        alert('Failed to like tweet. Please try again.')
      }
    }
  }

  const getAvatarEmoji = (author) => {
    const emojis = ['🤖', '🦾', '🧠', '⚡', '🔮', '🎯', '🚀', '💡', '🔧', '🎨', '🌟', '🎭', '🎪', '🎸', '🎮', '🕹️', '🎲', '🎯', '🎨', '🎬']
    let hash = 0
    for (let i = 0; i < author.length; i++) {
      hash = author.charCodeAt(i) + ((hash << 5) - hash)
    }
    return emojis[Math.abs(hash) % emojis.length]
  }

  return (
    <div className="tweet">
      <div className="tweet-header">
        <div className="avatar">
          <span>{getAvatarEmoji(tweet.author)}</span>
        </div>
        <div className="user-info">
          <span className="username">@{tweet.author}</span>
          <span className="handle">· {formatTime(tweet.timestamp)}</span>
        </div>
      </div>
      
      <div className="tweet-content">
        {tweet.content}
      </div>
      
      <div className="tweet-actions">
        <button className="action-btn">
          <svg viewBox="0 0 24 24" className="icon icon-reply">
            <path d="M14.046 2.242l-4.148-.01h-.002c-4.374 0-7.8 3.427-7.8 7.802 0 4.098 3.186 7.206 7.465 7.37.07.002.14.002.21.002h.002c1.582 0 3.058-.58 4.22-1.64l1.348 1.348c.195.195.45.293.707.293s.512-.098.707-.293c.39-.39.39-1.023 0-1.414l-1.348-1.348c1.06-1.162 1.64-2.638 1.64-4.22 0-4.375-3.427-7.802-7.8-7.802zm-4.046 12.8c-3.18 0-5.76-2.58-5.76-5.76s2.58-5.76 5.76-5.76 5.76 2.58 5.76 5.76-2.58 5.76-5.76 5.76z"/>
          </svg>
          <span>{Math.floor(Math.random() * 5)}</span>
        </button>
        <button className="action-btn">
          <svg viewBox="0 0 24 24" className="icon icon-retweet">
            <path d="M23.77 15.67c-.292-.293-.767-.293-1.06 0l-2.22 2.22V7.65c0-2.068-1.683-3.75-3.75-3.75h-5.85c-.414 0-.75.336-.75.75s.336.75.75.75h5.85c1.24 0 2.25 1.01 2.25 2.25v10.24l-2.22-2.22c-.293-.293-.768-.293-1.06 0s-.294.768 0 1.06l3.5 3.5c.145.147.337.22.53.22s.383-.072.53-.22l3.5-3.5c.293-.292.293-.767 0-1.06zm-10.66 3.28H7.26c-1.24 0-2.25-1.01-2.25-2.25V6.46l2.22 2.22c.147.147.337.22.53.22s.383-.073.53-.22c.293-.293.293-.768 0-1.06l-3.5-3.5c-.293-.293-.768-.293-1.06 0l-3.5 3.5c-.293.293-.293.768 0 1.06s.767.293 1.06 0l2.22-2.22V16.7c0 2.068 1.683 3.75 3.75 3.75h5.85c.414 0 .75-.336.75-.75s-.336-.75-.75-.75z"/>
          </svg>
          <span>{tweet.retweets}</span>
        </button>
        <button 
          className={`action-btn ${isLiked ? 'liked' : ''}`} 
          onClick={handleLike}
          disabled={isLiked}
        >
          <svg viewBox="0 0 24 24" className={`icon ${isLiked ? 'icon-heart-filled' : 'icon-heart'}`}>
            {isLiked ? (
              <path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.378-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-2.91 1.23 0 2.5.5 3.5 1.5 1-1 2.27-1.5 3.5-1.5 1.954 0 3.714 1.12 4.601 2.91.896 1.81.846 4.17-.514 6.67z"/>
            ) : (
              <path d="M12 21.638h-.014C9.403 21.59 1.95 14.856 1.95 8.478c0-3.064 2.525-5.754 5.403-5.754 1.29 0 2.63.56 3.3 1.5.67-.94 2.01-1.5 3.3-1.5 2.878 0 5.403 2.69 5.403 5.755 0 6.376-7.454 13.11-10.037 13.157H12z"/>
            )}
          </svg>
          <span>{likes}</span>
        </button>
        <button className="action-btn">
          <svg viewBox="0 0 24 24" className="icon icon-share">
            <path d="M17.53 7.47l-5-5c-.29-.29-.77-.29-1.06 0l-5 5c-.29.29-.29.77 0 1.06.29.29.77.29 1.06 0l3.72-3.72V15c0 .55.45 1 1 1s1-.45 1-1V4.81l3.72 3.72c.29.29.77.29 1.06 0 .29-.29.29-.77 0-1.06z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default Tweet
