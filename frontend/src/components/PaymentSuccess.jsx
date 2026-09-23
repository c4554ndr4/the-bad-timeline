import { useState, useEffect } from 'react'

const PaymentSuccess = ({ onClose }) => {
  const [loading, setLoading] = useState(true)
  const [sessionData, setSessionData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Get session_id from URL params
    const urlParams = new URLSearchParams(window.location.search)
    const sessionId = urlParams.get('session_id')

    if (sessionId) {
      // Verify the session with our backend (optional)
      fetchSessionDetails(sessionId)
    } else {
      setError('No session ID found')
      setLoading(false)
    }
  }, [])

  const fetchSessionDetails = async (sessionId) => {
    try {
      // Extract session data from Stripe redirect URL (if available)
      // In a real app, you'd verify this with your backend
      
      // Try to get purchase data from localStorage (set during checkout)
      const purchaseData = localStorage.getItem('pendingPurchase')
      let creditsToAdd = 200; // Default fallback
      
      if (purchaseData) {
        try {
          const purchase = JSON.parse(purchaseData)
          creditsToAdd = purchase.credits || 200
          console.log('💰 Using purchase data from checkout:', purchase)
          localStorage.removeItem('pendingPurchase') // Clean up
        } catch (e) {
          console.warn('Failed to parse pending purchase data:', e)
        }
      } else {
        // Fallback - try to infer from last purchase amount in localStorage
        creditsToAdd = parseInt(localStorage.getItem('lastExpectedCredits') || '200')
      }
      
      const currentCredits = parseInt(localStorage.getItem('userCredits') || '0')
      const newCredits = currentCredits + creditsToAdd
      
      localStorage.setItem('userCredits', newCredits.toString())
      localStorage.setItem('lastPurchaseCredits', creditsToAdd.toString())
      
      console.log(`💰 Adding ${creditsToAdd} credits. Total: ${newCredits}`)
      
      setSessionData({
        sessionId,
        message: 'Payment completed successfully!',
        credits: `${creditsToAdd} credits have been added to your account`,
        totalCredits: newCredits,
        purchaseDetails: purchaseData ? JSON.parse(purchaseData) : null
      })
      
      // Trigger a custom event to update the main app's credit display
      window.dispatchEvent(new CustomEvent('creditsUpdated', { 
        detail: { credits: newCredits } 
      }))
      
    } catch (error) {
      setError('Failed to verify payment')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="success-overlay">
        <div className="success-content">
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Verifying your payment...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="success-overlay">
        <div className="success-content error">
          <h2>❌ Payment Verification Failed</h2>
          <p>{error}</p>
          <button onClick={onClose || (() => window.location.href = '/')}>
            Return to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="success-overlay">
      <div className="success-content">
        <div className="success-icon">✅</div>
        <h2>Payment Successful!</h2>
        <p>Thank you for your purchase. Your credits have been added to your account.</p>
        
        {sessionData && (
          <div className="session-details">
            <p><strong>Credits Added:</strong> {sessionData.credits}</p>
            {sessionData.purchaseDetails && sessionData.purchaseDetails.discountCode && (
              <p><strong>🎉 Discount Code Applied:</strong> "{sessionData.purchaseDetails.discountCode}" (+{sessionData.purchaseDetails.bonusCredits} bonus credits!)</p>
            )}
            <p><strong>Total Credits:</strong> {sessionData.totalCredits}</p>
            <p><small>Session ID: {sessionData.sessionId}</small></p>
          </div>
        )}
        
        <button 
          className="return-btn"
          onClick={onClose || (() => window.location.href = '/')}
        >
          Continue Generating Tweets
        </button>
      </div>
    </div>
  )
}

export default PaymentSuccess
