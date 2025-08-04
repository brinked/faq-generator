import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';

const PublicFAQDisplay = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [faqs, setFaqs] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });
  const [stats, setStats] = useState(null);
  const [userVotes, setUserVotes] = useState({});

  // Fetch FAQs
  const fetchFAQs = async (page = 1, search = '', category = '') => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(search && { search }),
        ...(category && { category })
      });

      const data = await apiService.get(`/api/public/faqs?${params}`);

      if (data.success) {
        setFaqs(data.faqs || []);
        setCategories(data.categories || []);
        setPagination(data.pagination);
      } else {
        console.log('Failed to load FAQs');
        setFaqs([]);
        setCategories([]);
      }
    } catch (error) {
      console.error('Error fetching FAQs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch stats
  const fetchStats = async () => {
    try {
      const data = await apiService.get('/api/public/faqs/stats');
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // Handle search
  const handleSearch = (e) => {
    e.preventDefault();
    const newSearch = searchQuery.trim();
    const newCategory = selectedCategory;

    setSearchParams({
      ...(newSearch && { search: newSearch }),
      ...(newCategory && { category: newCategory })
    });

    fetchFAQs(1, newSearch, newCategory);
  };

  // Handle category change
  const handleCategoryChange = (category) => {
    const newCategory = category === selectedCategory ? '' : category;
    setSelectedCategory(newCategory);

    setSearchParams({
      ...(searchQuery && { search: searchQuery }),
      ...(newCategory && { category: newCategory })
    });

    fetchFAQs(1, searchQuery, newCategory);
  };

  // Handle page change
  const handlePageChange = (page) => {
    fetchFAQs(page, searchQuery, selectedCategory);
  };

  // Handle feedback with toggle functionality
  const handleFeedback = async (faqId, helpful) => {
    const currentVote = userVotes[faqId];
    let newVote = null;
    let shouldSubmit = false;

    // Determine the new vote state
    if (currentVote === 'helpful') {
      if (helpful) {
        // User clicked helpful again - remove vote
        newVote = null;
        shouldSubmit = true;
      } else {
        // User clicked not helpful - change to not helpful
        newVote = 'not_helpful';
        shouldSubmit = true;
      }
    } else if (currentVote === 'not_helpful') {
      if (helpful) {
        // User clicked helpful - change to helpful
        newVote = 'helpful';
        shouldSubmit = true;
      } else {
        // User clicked not helpful again - remove vote
        newVote = null;
        shouldSubmit = true;
      }
    } else {
      // No previous vote - add new vote
      newVote = helpful ? 'helpful' : 'not_helpful';
      shouldSubmit = true;
    }

    if (!shouldSubmit) return;

    try {
      // Submit feedback to server
      await apiService.post(`/api/public/faqs/${faqId}/feedback`, {
        helpful: newVote === 'helpful',
        removeVote: newVote === null
      });

      // Update the FAQ in the list
      setFaqs(prevFaqs =>
        prevFaqs.map(faq => {
          if (faq.id !== faqId) return faq;

          let newHelpfulCount = faq.helpful_count;
          let newNotHelpfulCount = faq.not_helpful_count;

          // Adjust counts based on vote change
          if (currentVote === 'helpful' && newVote === null) {
            // Removing helpful vote
            newHelpfulCount = Math.max(0, faq.helpful_count - 1);
          } else if (currentVote === 'not_helpful' && newVote === null) {
            // Removing not helpful vote
            newNotHelpfulCount = Math.max(0, faq.not_helpful_count - 1);
          } else if (currentVote === 'helpful' && newVote === 'not_helpful') {
            // Changing from helpful to not helpful
            newHelpfulCount = Math.max(0, faq.helpful_count - 1);
            newNotHelpfulCount = faq.not_helpful_count + 1;
          } else if (currentVote === 'not_helpful' && newVote === 'helpful') {
            // Changing from not helpful to helpful
            newHelpfulCount = faq.helpful_count + 1;
            newNotHelpfulCount = Math.max(0, faq.not_helpful_count - 1);
          } else if (currentVote === null && newVote === 'helpful') {
            // Adding helpful vote
            newHelpfulCount = faq.helpful_count + 1;
          } else if (currentVote === null && newVote === 'not_helpful') {
            // Adding not helpful vote
            newNotHelpfulCount = faq.not_helpful_count + 1;
          }

          return {
            ...faq,
            helpful_count: newHelpfulCount,
            not_helpful_count: newNotHelpfulCount
          };
        })
      );

      // Update user votes
      const newUserVotes = {
        ...userVotes,
        [faqId]: newVote
      };

      // Remove the entry if vote is null
      if (newVote === null) {
        delete newUserVotes[faqId];
      }

      setUserVotes(newUserVotes);
      localStorage.setItem('faq_user_votes', JSON.stringify(newUserVotes));

      // Show appropriate message
      if (newVote === null) {
        toast.success('Vote removed');
      } else {
        toast.success('Thank you for your feedback!');
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback');
    }
  };

  // Load user votes from localStorage
  useEffect(() => {
    const savedVotes = localStorage.getItem('faq_user_votes');
    if (savedVotes) {
      setUserVotes(JSON.parse(savedVotes));
    }
  }, []);

  // Initialize
  useEffect(() => {
    fetchFAQs(1, searchQuery, selectedCategory);
    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-2 sm:px-6 lg:px-8">
          <Link to="/" className="text-2xl font-bold text-gray-900 mb-2 block">
            <div className="flex items-center space-x-4">
            <div className="relative">
              <div className="flex items-center justify-center w-14 h-14 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-2xl shadow-lg">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-800 bg-clip-text text-transparent">
                FAQ Generator
              </h1>
              <p className="text-sm text-gray-600 font-medium">
                AI-powered FAQ generation from your emails
              </p>
            </div>
          </div>
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Frequently Asked Questions
          </h1>
          {stats && (
            <p className="text-gray-600">
              {stats.totalFaqs} questions • {stats.totalCategories} categories
            </p>
          )}
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for answers..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
              >
                Search
              </button>
            </div>

            {/* Category Filters */}
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleCategoryChange('')}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    !selectedCategory
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  All Categories
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => handleCategoryChange(category)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      selectedCategory === category
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        {/* FAQ List */}
        <div className="space-y-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading FAQs...</p>
            </div>
          ) : faqs.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.47-.881-6.08-2.33" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No FAQs found</h3>
              <p className="text-gray-600">
                {searchQuery || selectedCategory
                  ? 'Try adjusting your search or category filter.'
                  : 'No FAQs are available at the moment.'
                }
              </p>
            </div>
          ) : (
            <AnimatePresence>
              {faqs.map((faq, index) => (
                <motion.div
                  key={faq.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                          {faq.title}
                        </h3>
                        <p className="text-gray-600 mb-4">
                          {faq.question}
                        </p>
                        <div className="prose max-w-none text-gray-700">
                          {faq.answer}
                        </div>
                      </div>
                    </div>

                    {/* Meta information */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        {faq.category && (
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                            {faq.category}
                          </span>
                        )}
                      </div>

                      {/* Feedback buttons */}
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleFeedback(faq.id, true)}
                          className={`flex items-center space-x-1 text-sm transition-colors px-2 py-1 rounded ${
                            userVotes[faq.id] === 'helpful' 
                              ? 'text-green-700 bg-green-50 border border-green-200' 
                              : 'text-green-600 hover:text-green-700 hover:bg-green-50'
                          }`}
                        >
                          <svg className="w-4 h-4" fill={userVotes[faq.id] === 'helpful' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                          </svg>
                          <span>
                            {userVotes[faq.id] === 'helpful' ? '✓ ' : ''}Helpful ({faq.helpful_count})
                          </span>
                        </button>
                        <button
                          onClick={() => handleFeedback(faq.id, false)}
                          className={`flex items-center space-x-1 text-sm transition-colors px-2 py-1 rounded ${
                            userVotes[faq.id] === 'not_helpful' 
                              ? 'text-red-700 bg-red-50 border border-red-200' 
                              : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                          }`}
                        >
                          <svg className="w-4 h-4" fill={userVotes[faq.id] === 'not_helpful' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2" />
                          </svg>
                          <span>
                            {userVotes[faq.id] === 'not_helpful' ? '✓ ' : ''}Not Helpful ({faq.not_helpful_count})
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex justify-center mt-8">
            <nav className="flex items-center space-x-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>

              {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    page === pagination.page
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </nav>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicFAQDisplay;
