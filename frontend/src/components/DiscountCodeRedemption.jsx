import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import api from '../lib/api'

const DiscountCodeRedemption = ({ onCreditsAdded }) => {
  const [discountCode, setDiscountCode] = useState('')
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('') // 'success' or 'error'
  const [hasUsedCode, setHasUsedCode] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    checkDiscountCodeUsage()
  }, [])

  const checkDiscountCodeUsage = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      console.log('🔍 Checking discount code usage, session:', !!session?.access_token)
      
      if (!session?.access_token) {
        console.log('📝 No session, checking localStorage...')
        // Check localStorage for used codes
        const usedCodes = JSON.parse(localStorage.getItem('usedDiscountCodes') || '[]')
        console.log('📝 Used codes in localStorage:', usedCodes)
        if (usedCodes.includes('cassandraiscool')) {
          console.log('⚠️ Discount code already used (localStorage)')
          setHasUsedCode(true)
        }
        return
      }

      // Check if user has already redeemed the discount code via API
      const response = await api.get('/api/user/credits', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })
      
      console.log('💰 User credits response:', response.data)
      
      // If user has earned credits, they might have used the discount code
      // We could add a specific endpoint to check redemptions, but for now
      // we'll use the total earned credits as an indicator
      if (response.data.totalEarned > 0) {
        console.log('⚠️ User has earned credits, assuming discount code used')
        setHasUsedCode(true)
      }
      
    } catch (error) {
      console.error('Error checking discount code usage:', error)
    }
  }

  const handleRedeemCode = async (e) => {
    e.preventDefault()
    
    if (!discountCode.trim()) {
      setMessage('Please enter a discount code')
      setMessageType('error')
      return
    }

    setIsRedeeming(true)
    setMessage('')

    try {
      // Get current session - don't require it for now
      const { data: { session } } = await supabase.auth.getSession()
      // Temporarily allow redemption without authentication for testing
      const isAuthenticated = session?.access_token

      try {
        // First, try the Supabase API if authenticated
        if (isAuthenticated) {
          const response = await api.post('/api/discount/redeem', {
            discountCode: discountCode.trim()
          }, {
            headers: {
              'Authorization': `Bearer ${session.access_token}`
            }
          })

          console.log(`🎉 Redeemed discount code via Supabase! Added ${response.data.creditsAwarded} credits. Total: ${response.data.newBalance}`)

          setMessage(`🎉 Success! ${response.data.creditsAwarded} credits added to your account!`)
          setMessageType('success')
          setHasUsedCode(true)
          setDiscountCode('')

          // Trigger the callback to update parent component
          if (onCreditsAdded) {
            onCreditsAdded(response.data.creditsAwarded, response.data.newBalance)
          }

          // Trigger global event to update credit display
          window.dispatchEvent(new CustomEvent('creditsUpdated', { 
            detail: { credits: response.data.newBalance } 
          }))
          
          return
        }
        
        // If not authenticated, skip to fallback method
        throw new Error('Not authenticated - using fallback')

      } catch (apiError) {
        console.error('Supabase API failed, falling back to localStorage method:', apiError)
        
        // Fallback to localStorage method for now
        if (discountCode.trim().toLowerCase() !== 'cassandraiscool') {
          setMessage('Invalid discount code')
          setMessageType('error')
          return
        }

        // Check if already used locally
        const usedCodes = JSON.parse(localStorage.getItem('usedDiscountCodes') || '[]')
        if (usedCodes.includes('cassandraiscool')) {
          setMessage('This discount code has already been used')
          setMessageType('error')
          return
        }

        // Add 200 credits to localStorage
        const currentCredits = parseInt(localStorage.getItem('userCredits') || '0')
        const newCredits = currentCredits + 200
        
        localStorage.setItem('userCredits', newCredits.toString())
        
        // Mark code as used locally
        const updatedUsedCodes = [...usedCodes, 'cassandraiscool']
        localStorage.setItem('usedDiscountCodes', JSON.stringify(updatedUsedCodes))
        
        console.log(`🎉 Redeemed discount code via localStorage! Added 200 credits. Total: ${newCredits}`)

        if (isAuthenticated) {
          setMessage('🎉 Success! 200 credits added to your account!')
        } else {
          setMessage('🎉 Success! 200 credits added! Please sign up to save your credits.')
        }
        setMessageType('success')
        setHasUsedCode(true)
        setDiscountCode('')

        // Trigger the callback to update parent component
        if (onCreditsAdded) {
          onCreditsAdded(200, newCredits)
        }

        // Trigger global event to update credit display
        window.dispatchEvent(new CustomEvent('creditsUpdated', { 
          detail: { credits: newCredits } 
        }))
      }

    } catch (error) {
      console.error('Error redeeming discount code:', error)
      setMessage('Error redeeming code. Please try again.')
      setMessageType('error')
    } finally {
      setIsRedeeming(false)
    }
  }

  // Don't show if already used
  if (hasUsedCode) {
    console.log('🚫 Promo code component hidden - hasUsedCode:', hasUsedCode)
    return null
  }

  console.log('✅ Promo code component visible - hasUsedCode:', hasUsedCode, 'isOpen:', isOpen)

  return (
    <div className="promo-corner">
      {!isOpen ? (
        <button 
          className="promo-trigger"
          onClick={() => setIsOpen(true)}
        >
          enter promo code
        </button>
      ) : (
        <div className="promo-popup">
          <form onSubmit={handleRedeemCode} className="promo-form">
            <input
              type="text"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              placeholder="Enter promo code"
              className="promo-input"
              disabled={isRedeeming}
              maxLength={50}
              autoFocus
            />
            <div className="promo-buttons">
              <button 
                type="submit"
                className="promo-submit"
                disabled={isRedeeming || !discountCode.trim()}
              >
                {isRedeeming ? '...' : 'OK'}
              </button>
              <button 
                type="button"
                className="promo-close"
                onClick={() => setIsOpen(false)}
              >
                ×
              </button>
            </div>
          </form>
          
          {message && (
            <div className={`promo-message ${messageType}`}>
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DiscountCodeRedemption
