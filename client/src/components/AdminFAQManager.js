import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';
import LoadingSpinner, { ButtonSpinner } from './LoadingSpinner';

const AdminFAQManager = ({ onBack }) => {
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFAQ, setEditingFAQ] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categories, setCategories] = useState([]);
  const [newFAQ, setNewFAQ] = useState({
    title: '',
    question: '',
    answer: '',
    category: '',
    tags: []
  });

  // Fetch FAQs
  const fetchFAQs = async () => {
    try {
      setLoading(true);
      const response = await apiService.get('/api/admin/faqs');
      if (response.success) {
        setFaqs(response.faqs);
        setCategories(response.categories || []);
      }
    } catch (error) {
      console.error('Error fetching FAQs:', error);
      toast.error('Failed to load FAQs');
    } finally {
      setLoading(false);
    }
  };

  // Save FAQ order with debouncing
  const saveFAQOrder = async (newOrder) => {
    try {
      // Update local state immediately for better UX
      const updatedFAQs = newOrder.map((faq, index) => ({
        ...faq,
        sort_order: index + 1
      }));
      setFaqs(updatedFAQs);

      // Debounce the API call
      if (window.reorderTimeout) {
        clearTimeout(window.reorderTimeout);
      }

      window.reorderTimeout = setTimeout(async () => {
        try {
          setSaving(true);
          await apiService.put('/api/admin/faqs/reorder', { faqs: updatedFAQs });
          toast.success('FAQ order updated successfully');
        } catch (error) {
          console.error('Error saving FAQ order:', error);
          toast.error('Failed to save FAQ order');
          // Reload FAQs on error to restore correct order
          fetchFAQs();
        } finally {
          setSaving(false);
        }
      }, 1000); // Wait 1 second after user stops dragging
    } catch (error) {
      console.error('Error updating FAQ order:', error);
    }
  };

  // Add new FAQ
  const handleAddFAQ = async () => {
    try {
      setSaving(true);
      const faqData = {
        ...newFAQ,
        tags: newFAQ.tags || [] // Ensure tags is always an array
      };
      const response = await apiService.post('/api/admin/faqs', faqData);
      if (response.success) {
        toast.success('FAQ added successfully');
        setShowAddModal(false);
        setNewFAQ({ title: '', question: '', answer: '', category: '', tags: [] });
        fetchFAQs();
      }
    } catch (error) {
      console.error('Error adding FAQ:', error);
      toast.error('Failed to add FAQ');
    } finally {
      setSaving(false);
    }
  };

  // Update FAQ
  const handleUpdateFAQ = async () => {
    try {
      setSaving(true);
      const faqData = {
        ...editingFAQ,
        tags: editingFAQ.tags || [] // Ensure tags is always an array
      };
      const response = await apiService.put(`/api/admin/faqs/${editingFAQ.id}`, faqData);
      if (response.success) {
        toast.success('FAQ updated successfully');
        setEditingFAQ(null);
        fetchFAQs();
      }
    } catch (error) {
      console.error('Error updating FAQ:', error);
      toast.error('Failed to update FAQ');
    } finally {
      setSaving(false);
    }
  };

  // Delete FAQ
  const handleDeleteFAQ = async (faqId) => {
    if (!window.confirm('Are you sure you want to delete this FAQ?')) return;

    try {
      setSaving(true);
      const response = await apiService.delete(`/api/admin/faqs/${faqId}`);
      if (response.success) {
        toast.success('FAQ deleted successfully');
        await fetchFAQs();
      }
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      toast.error('Failed to delete FAQ');
    } finally {
      setSaving(false);
    }
  };

  // Toggle FAQ publish status
  const handleTogglePublish = async (faq) => {
    try {
      setSaving(true);
      const faqData = {
        ...faq,
        is_published: !faq.is_published,
        tags: faq.tags || [] // Ensure tags is always an array
      };
      const response = await apiService.put(`/api/admin/faqs/${faq.id}`, faqData);
      if (response.success) {
        toast.success(`FAQ ${faq.is_published ? 'unpublished' : 'published'} successfully`);
        fetchFAQs();
      }
    } catch (error) {
      console.error('Error toggling FAQ publish status:', error);
      toast.error('Failed to update FAQ status');
    } finally {
      setSaving(false);
    }
  };

  // Filter FAQs
  const filteredFAQs = faqs.filter(faq => {
    const matchesSearch = !searchQuery ||
      faq.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  useEffect(() => {
    fetchFAQs();

    // Cleanup timeout on unmount
    return () => {
      if (window.reorderTimeout) {
        clearTimeout(window.reorderTimeout);
      }
    };
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 right-10 w-96 h-96 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse-slow"></div>
        <div className="absolute bottom-20 left-10 w-96 h-96 bg-gradient-to-r from-purple-400 to-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse-slow" style={{animationDelay: '3s'}}></div>
      </div>

      {/* Enhanced Header */}
      <div className="relative glass border-b border-white/20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col lg:flex-row lg:justify-between lg:items-center py-8 gap-6"
          >
            <div className="flex items-center space-x-4">
              <motion.button
                onClick={onBack}
                whileHover={{ scale: 1.05, x: -2 }}
                whileTap={{ scale: 0.95 }}
                className="group p-3 text-gray-600 hover:text-gray-900 transition-all duration-200 bg-white/60 hover:bg-white/80 rounded-xl backdrop-blur-sm border border-white/30 hover:shadow-lg"
              >
                <svg className="w-6 h-6 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </motion.button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-800 bg-clip-text text-transparent">
                  FAQ Management
                </h1>
                <p className="text-gray-600 mt-2">Organize, edit, and publish your frequently asked questions</p>
              </div>
            </div>
            
            <motion.button
              onClick={() => setShowAddModal(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group relative overflow-hidden bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl border border-blue-400/50"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div className="relative flex items-center space-x-2">
                <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Add New FAQ</span>
              </div>
            </motion.button>
          </motion.div>
        </div>
      </div>

      {/* Enhanced Filters */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="glass rounded-2xl shadow-xl border border-white/30 p-8 backdrop-blur-xl relative overflow-hidden mb-8"
        >
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 pointer-events-none"></div>
          
          <div className="relative">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Filter & Search</h2>
                <p className="text-sm text-gray-600 mt-1">Find and organize your FAQs efficiently</p>
              </div>
              <div className="text-sm text-gray-500">
                {filteredFAQs.length} FAQ{filteredFAQs.length !== 1 ? 's' : ''} found
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-3">Search FAQs</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search questions, answers, or categories..."
                    className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/80 backdrop-blur-sm transition-all duration-200 placeholder-gray-400"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center"
                    >
                      <svg className="h-4 w-4 text-gray-400 hover:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/80 backdrop-blur-sm transition-all duration-200 appearance-none cursor-pointer"
                >
                  <option value="all">All Categories</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">Actions</label>
                <motion.button
                  onClick={fetchFAQs}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={saving}
                  className="w-full group relative overflow-hidden bg-white/90 hover:bg-white text-gray-700 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 px-4 py-3 rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl border border-white/50 hover:border-white"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-50 to-gray-100 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  {saving ? (
                    <ButtonSpinner />
                  ) : (
                    <svg className="w-4 h-4 transition-transform group-hover:rotate-180 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span className="relative z-10">Refresh</span>
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Enhanced FAQ List */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="glass rounded-2xl shadow-xl border border-white/30 backdrop-blur-xl relative overflow-hidden"
        >
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-blue-500/5 pointer-events-none"></div>
          
          <div className="relative">
            <div className="px-8 py-6 border-b border-white/20">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 flex items-center">
                        Manage FAQs ({filteredFAQs.length})
                        {saving && <ButtonSpinner className="ml-3" />}
                      </h2>
                      <p className="text-sm text-gray-600 mt-1">
                        Drag and drop to reorder • Changes are auto-saved • Published FAQs appear on your public page
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Quick Stats */}
                <div className="flex items-center space-x-4">
                  <div className="text-center p-3 bg-white/60 rounded-xl backdrop-blur-sm border border-white/30">
                    <div className="text-lg font-bold text-green-600">{faqs.filter(f => f.is_published).length}</div>
                    <div className="text-xs text-gray-600 font-medium">Published</div>
                  </div>
                  <div className="text-center p-3 bg-white/60 rounded-xl backdrop-blur-sm border border-white/30">
                    <div className="text-lg font-bold text-orange-600">{faqs.filter(f => !f.is_published).length}</div>
                    <div className="text-xs text-gray-600 font-medium">Drafts</div>
                  </div>
                  <div className="text-center p-3 bg-white/60 rounded-xl backdrop-blur-sm border border-white/30">
                    <div className="text-lg font-bold text-blue-600">{categories.length - 1}</div>
                    <div className="text-xs text-gray-600 font-medium">Categories</div>
                  </div>
                </div>
              </div>
            </div>

          <Reorder.Group
            axis="y"
            values={filteredFAQs}
            onReorder={saveFAQOrder}
            className="divide-y divide-gray-200"
          >
            <AnimatePresence>
              {filteredFAQs.map((faq) => (
                <Reorder.Item
                  key={faq.id}
                  value={faq}
                  className="group"
                >
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.01 }}
                    transition={{ duration: 0.2 }}
                    className="mx-2 md:mx-6 my-4 p-4 md:p-6 bg-white/60 backdrop-blur-sm rounded-xl border border-white/30 hover:border-white/50 shadow-lg hover:shadow-xl transition-all duration-300 cursor-move relative overflow-hidden faq-card-mobile"
                  >
                    {/* Drag indicator overlay */}
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                    
                    <div className="relative flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {/* Header with drag handle and badges */}
                        <div className="flex items-center space-x-3 mb-4">
                          <motion.div 
                            whileHover={{ scale: 1.1 }}
                            className="flex items-center justify-center w-8 h-8 bg-gradient-to-br from-gray-200 to-gray-300 rounded-lg cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-all duration-200"
                          >
                            <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                            </svg>
                          </motion.div>
                          
                          <div className="flex items-center space-x-2 flex-wrap">
                            <motion.span 
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className={`px-3 py-1 text-xs font-medium rounded-full shadow-sm ${
                                faq.is_published 
                                  ? 'bg-gradient-to-r from-green-100 to-green-200 text-green-800 border border-green-300' 
                                  : 'bg-gradient-to-r from-yellow-100 to-yellow-200 text-yellow-800 border border-yellow-300'
                              }`}
                            >
                              {faq.is_published ? '✓ Published' : '⏳ Draft'}
                            </motion.span>
                            
                            {faq.category && (
                              <motion.span 
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.1 }}
                                className="px-3 py-1 text-xs font-medium bg-gradient-to-r from-blue-100 to-blue-200 text-blue-800 rounded-full border border-blue-300 shadow-sm"
                              >
                                📁 {faq.category}
                              </motion.span>
                            )}
                            
                            <motion.span 
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ delay: 0.2 }}
                              className="px-3 py-1 text-xs font-medium bg-gradient-to-r from-purple-100 to-purple-200 text-purple-800 rounded-full border border-purple-300 shadow-sm"
                            >
                              #{faq.sort_order || 'N/A'}
                            </motion.span>
                          </div>
                        </div>

                        {/* Content */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-bold text-gray-900 leading-tight">
                            {faq.title || faq.question}
                          </h3>

                          <div className="space-y-3">
                            <div className="p-4 bg-blue-50/80 rounded-lg border border-blue-200/50">
                              <div className="flex items-start space-x-2">
                                <div className="flex-shrink-0 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center mt-0.5">
                                  <span className="text-white text-xs font-bold">Q</span>
                                </div>
                                <p className="text-gray-800 font-medium leading-relaxed">{faq.question}</p>
                              </div>
                            </div>
                            
                            <div className="p-4 bg-green-50/80 rounded-lg border border-green-200/50">
                              <div className="flex items-start space-x-2">
                                <div className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                                  <span className="text-white text-xs font-bold">A</span>
                                </div>
                                <p className="text-gray-800 leading-relaxed">{faq.answer}</p>
                              </div>
                            </div>
                          </div>

                          {/* Statistics */}
                          {(faq.question_count || faq.view_count || faq.helpful_count) && (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-gray-200/50">
                              {faq.question_count && (
                                <div className="text-center p-2 bg-white/60 rounded-lg border border-gray-200/50">
                                  <div className="text-sm font-bold text-gray-900">{faq.question_count}</div>
                                  <div className="text-xs text-gray-600">Questions</div>
                                </div>
                              )}
                              <div className="text-center p-2 bg-white/60 rounded-lg border border-gray-200/50">
                                <div className="text-sm font-bold text-gray-900">{faq.view_count || 0}</div>
                                <div className="text-xs text-gray-600">Views</div>
                              </div>
                              <div className="text-center p-2 bg-white/60 rounded-lg border border-gray-200/50">
                                <div className="text-sm font-bold text-green-600">{faq.helpful_count || 0}</div>
                                <div className="text-xs text-gray-600">Helpful</div>
                              </div>
                              <div className="text-center p-2 bg-white/60 rounded-lg border border-gray-200/50">
                                <div className="text-sm font-bold text-red-600">{faq.not_helpful_count || 0}</div>
                                <div className="text-xs text-gray-600">Not Helpful</div>
                              </div>
                              {faq.avg_confidence && (
                                <div className="text-center p-2 bg-white/60 rounded-lg border border-gray-200/50 lg:col-span-4">
                                  <div className="text-sm font-bold text-purple-600">{(faq.avg_confidence * 100).toFixed(1)}%</div>
                                  <div className="text-xs text-gray-600">Confidence</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col space-y-2 ml-6 opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity duration-200 mobile-action-buttons">
                        <motion.button
                          onClick={() => handleTogglePublish(faq)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md ${
                            faq.is_published
                              ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white hover:from-yellow-500 hover:to-orange-600'
                              : 'bg-gradient-to-r from-green-400 to-green-600 text-white hover:from-green-500 hover:to-green-700'
                          }`}
                        >
                          {faq.is_published ? 'Unpublish' : 'Publish'}
                        </motion.button>

                        <motion.button
                          onClick={() => setEditingFAQ(faq)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-blue-400 to-blue-600 text-white rounded-lg hover:from-blue-500 hover:to-blue-700 transition-all duration-200 shadow-sm hover:shadow-md"
                        >
                          Edit
                        </motion.button>

                        <motion.button
                          onClick={() => handleDeleteFAQ(faq.id)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-red-400 to-red-600 text-white rounded-lg hover:from-red-500 hover:to-red-700 transition-all duration-200 shadow-sm hover:shadow-md"
                        >
                          Delete
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>

          {filteredFAQs.length === 0 && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="p-12 text-center relative"
            >
              <div className="max-w-md mx-auto">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {searchQuery || selectedCategory !== 'all' ? 'No Matching FAQs' : 'No FAQs Yet'}
                </h3>
                
                <p className="text-gray-600 mb-6 leading-relaxed">
                  {searchQuery || selectedCategory !== 'all' 
                    ? 'Try adjusting your search terms or filters to find what you\'re looking for.'
                    : 'Get started by adding your first FAQ or import them from your processed emails.'
                  }
                </p>

                {(!searchQuery && selectedCategory === 'all') && (
                  <motion.button
                    onClick={() => setShowAddModal(true)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="group relative overflow-hidden bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl border border-blue-400/50"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative flex items-center space-x-2">
                      <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Create Your First FAQ</span>
                    </div>
                  </motion.button>
                )}
              </div>
            </motion.div>
          )}
          </div>
        </motion.div>
      </div>

      {/* Add FAQ Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Add New FAQ</h2>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                  <input
                    type="text"
                    value={newFAQ.title}
                    onChange={(e) => setNewFAQ({ ...newFAQ, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="FAQ Title"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Question</label>
                  <textarea
                    value={newFAQ.question}
                    onChange={(e) => setNewFAQ({ ...newFAQ, question: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Enter the question"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Answer</label>
                  <textarea
                    value={newFAQ.answer}
                    onChange={(e) => setNewFAQ({ ...newFAQ, answer: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={4}
                    placeholder="Enter the answer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                  <input
                    type="text"
                    value={newFAQ.category}
                    onChange={(e) => setNewFAQ({ ...newFAQ, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Account Management, Billing, etc."
                  />
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddFAQ}
                  disabled={saving || !newFAQ.question || !newFAQ.answer}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <ButtonSpinner /> : 'Add FAQ'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit FAQ Modal */}
      <AnimatePresence>
        {editingFAQ && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Edit FAQ</h2>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                  <input
                    type="text"
                    value={editingFAQ.title || ''}
                    onChange={(e) => setEditingFAQ({ ...editingFAQ, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="FAQ Title"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Question</label>
                  <textarea
                    value={editingFAQ.question || ''}
                    onChange={(e) => setEditingFAQ({ ...editingFAQ, question: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Enter the question"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Answer</label>
                  <textarea
                    value={editingFAQ.answer || ''}
                    onChange={(e) => setEditingFAQ({ ...editingFAQ, answer: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={4}
                    placeholder="Enter the answer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                  <input
                    type="text"
                    value={editingFAQ.category || ''}
                    onChange={(e) => setEditingFAQ({ ...editingFAQ, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Account Management, Billing, etc."
                  />
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={() => setEditingFAQ(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateFAQ}
                  disabled={saving || !editingFAQ.question || !editingFAQ.answer}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <ButtonSpinner /> : 'Update FAQ'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminFAQManager;
