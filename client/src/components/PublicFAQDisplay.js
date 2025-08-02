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
        toast.error('Failed to load FAQs');
        setFaqs([]);
        setCategories([]);
      }
    } catch (error) {
      console.error('Error fetching FAQs:', error);
      toast.error('Failed to load FAQs');
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

  // Handle feedback
  const handleFeedback = async (faqId, helpful) => {
    try {
      await apiService.post(`/api/public/faqs/${faqId}/feedback`, { helpful });

      // Update the FAQ in the list
      setFaqs(prevFaqs => 
        prevFaqs.map(faq => 
          faq.id === faqId 
            ? { 
                ...faq, 
                helpful_count: helpful ? faq.helpful_count + 1 : faq.helpful_count,
                not_helpful_count: helpful ? faq.not_helpful_count : faq.not_helpful_count + 1
              }
            : faq
        )
      );
      toast.success('Thank you for your feedback!');
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback');
    }
  };

  // Initialize
  useEffect(() => {
    fetchFAQs(1, searchQuery, selectedCategory);
    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="text-2xl font-bold text-gray-900">
              FAQ Generator
            </Link>
            <Link
              to="/admin/login"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Admin Login
            </Link>
          </div>
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
              {stats.totalFaqs} questions • {stats.totalCategories} categories • {stats.totalViews} views
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
                        <span>{faq.view_count} views</span>
                        <span>{faq.helpful_count + faq.not_helpful_count} responses</span>
                      </div>

                      {/* Feedback buttons */}
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleFeedback(faq.id, true)}
                          className="flex items-center space-x-1 text-green-600 hover:text-green-700 text-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                          </svg>
                          <span>Helpful ({faq.helpful_count})</span>
                        </button>
                        <button
                          onClick={() => handleFeedback(faq.id, false)}
                          className="flex items-center space-x-1 text-red-600 hover:text-red-700 text-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2" />
                          </svg>
                          <span>Not Helpful ({faq.not_helpful_count})</span>
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