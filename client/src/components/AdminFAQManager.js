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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">FAQ Management</h1>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add New FAQ
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search FAQs..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Categories</option>
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={fetchFAQs}
                className="w-full bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* FAQ List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              FAQs ({filteredFAQs.length})
              {saving && <ButtonSpinner className="ml-2" />}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Drag and drop to reorder FAQs. The order will be reflected on the public page.
            </p>
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
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center cursor-move">
                            <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                            </svg>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            faq.is_published 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {faq.is_published ? 'Published' : 'Draft'}
                          </span>
                          {faq.category && (
                            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                              {faq.category}
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {faq.title || faq.question}
                      </h3>

                      <div className="text-gray-600 mb-3">
                        <p className="mb-2"><strong>Q:</strong> {faq.question}</p>
                        <p><strong>A:</strong> {faq.answer}</p>
                        {faq.question_count && (
                          <p className="text-sm text-gray-500 mt-2">
                            Questions in group: {faq.question_count} |
                            Confidence: {faq.avg_confidence ? (faq.avg_confidence * 100).toFixed(1) + '%' : 'N/A'}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 text-sm text-gray-500">
                        <span>Sort Order: {faq.sort_order || 'N/A'}</span>
                        <span>•</span>
                        <span>Views: {faq.view_count || 0}</span>
                        <span>•</span>
                        <span>Helpful: {faq.helpful_count || 0}</span>
                        <span>•</span>
                        <span>Not Helpful: {faq.not_helpful_count || 0}</span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 ml-4">
                      <button
                        onClick={() => handleTogglePublish(faq)}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          faq.is_published
                            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                        }`}
                      >
                        {faq.is_published ? 'Unpublish' : 'Publish'}
                      </button>

                      <button
                        onClick={() => setEditingFAQ(faq)}
                        className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 transition-colors"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => handleDeleteFAQ(faq.id)}
                        className="px-3 py-1 text-sm bg-red-100 text-red-800 rounded-md hover:bg-red-200 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>

          {filteredFAQs.length === 0 && (
            <div className="p-6 text-center text-gray-500">
              No FAQs found. {searchQuery || selectedCategory !== 'all' ? 'Try adjusting your filters.' : 'Add your first FAQ!'}
            </div>
          )}
        </div>
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
