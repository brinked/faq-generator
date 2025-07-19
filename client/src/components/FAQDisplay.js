import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { apiService } from '../services/apiService';
import LoadingSpinner, { ButtonSpinner } from './LoadingSpinner';

const FAQDisplay = ({ faqs, connectedAccounts, onRefreshFAQs, onBackToProcessing }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('frequency');
  const [expandedFAQ, setExpandedFAQ] = useState(null);
  const [editingFAQ, setEditingFAQ] = useState(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '' });
  const [isExporting, setIsExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Get unique categories from FAQs
  const categories = useMemo(() => {
    const cats = [...new Set(faqs.map(faq => faq.category).filter(Boolean))];
    return ['all', ...cats];
  }, [faqs]);

  // Filter and sort FAQs
  const filteredFAQs = useMemo(() => {
    let filtered = faqs.filter(faq => {
      const matchesSearch = !searchQuery || 
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });

    // Sort FAQs
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'frequency':
          return (b.frequency || 0) - (a.frequency || 0);
        case 'recent':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'alphabetical':
          return a.question.localeCompare(b.question);
        default:
          return 0;
      }
    });

    return filtered;
  }, [faqs, searchQuery, selectedCategory, sortBy]);

  const handleEditFAQ = (faq) => {
    setEditingFAQ(faq.id);
    setEditForm({
      question: faq.question,
      answer: faq.answer
    });
  };

  const handleSaveEdit = async () => {
    try {
      await apiService.updateFAQ(editingFAQ, editForm);
      toast.success('FAQ updated successfully');
      setEditingFAQ(null);
      onRefreshFAQs();
    } catch (error) {
      console.error('Failed to update FAQ:', error);
      toast.error('Failed to update FAQ');
    }
  };

  const handleDeleteFAQ = async (faqId) => {
    if (!window.confirm('Are you sure you want to delete this FAQ?')) return;
    
    try {
      await apiService.deleteFAQ(faqId);
      toast.success('FAQ deleted successfully');
      onRefreshFAQs();
    } catch (error) {
      console.error('Failed to delete FAQ:', error);
      toast.error('Failed to delete FAQ');
    }
  };

  const handleExport = async (format) => {
    setIsExporting(true);
    try {
      const data = await apiService.exportFAQs(format);
      
      if (format === 'csv') {
        const blob = new Blob([data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `faqs-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `faqs-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
      
      toast.success(`FAQs exported as ${format.toUpperCase()}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export FAQs');
    } finally {
      setIsExporting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshFAQs();
    } finally {
      setRefreshing(false);
    }
  };

  const handlePublishFAQs = async () => {
    setPublishing(true);
    try {
      const result = await apiService.publishAllFAQs();
      toast.success(`Published ${result.publishedCount} FAQs successfully!`);
      onRefreshFAQs();
    } catch (error) {
      console.error('Failed to publish FAQs:', error);
      toast.error('Failed to publish FAQs');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-8"
      >
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Generated FAQs
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Here are the frequently asked questions automatically generated from your email analysis.
        </p>
      </motion.div>

      {/* Stats and Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card mb-8"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center space-x-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary-600">{faqs.length}</p>
              <p className="text-sm text-gray-600">Total FAQs</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success-600">{connectedAccounts.length}</p>
              <p className="text-sm text-gray-600">Connected Accounts</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-warning-600">{categories.length - 1}</p>
              <p className="text-sm text-gray-600">Categories</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-secondary flex items-center space-x-2"
            >
              {refreshing ? <ButtonSpinner /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              <span>Refresh</span>
            </button>

            <button
              onClick={handlePublishFAQs}
              disabled={publishing}
              className="btn-primary flex items-center space-x-2"
            >
              {publishing ? <ButtonSpinner /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span>Publish FAQs</span>
            </button>
            
            <div className="relative">
              <button
                className="btn-secondary flex items-center space-x-2"
                onClick={() => document.getElementById('export-menu').classList.toggle('hidden')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export</span>
              </button>
              
              <div id="export-menu" className="hidden absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
                <button
                  onClick={() => handleExport('json')}
                  disabled={isExporting}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export as JSON
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  disabled={isExporting}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export as CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Filters and Search */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card mb-8"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search FAQs</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search questions and answers..."
                className="input-field pl-10"
              />
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="input-field"
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category === 'all' ? 'All Categories' : category}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input-field"
            >
              <option value="frequency">Most Frequent</option>
              <option value="recent">Most Recent</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          </div>
        </div>
      </motion.div>

      {/* FAQ List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-4"
      >
        {filteredFAQs.length === 0 ? (
          <div className="card text-center py-12">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No FAQs Found</h3>
            <p className="text-gray-600 mb-4">
              {searchQuery || selectedCategory !== 'all' 
                ? 'No FAQs match your current filters.' 
                : 'No FAQs have been generated yet.'}
            </p>
            {!searchQuery && selectedCategory === 'all' && (
              <button onClick={onBackToProcessing} className="btn-primary">
                Back to Processing
              </button>
            )}
          </div>
        ) : (
          filteredFAQs.map((faq, index) => (
            <motion.div
              key={faq.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="faq-item"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {editingFAQ === faq.id ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Question</label>
                        <input
                          type="text"
                          value={editForm.question}
                          onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                          className="input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Answer</label>
                        <textarea
                          value={editForm.answer}
                          onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
                          rows={4}
                          className="input-field"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button onClick={handleSaveEdit} className="btn-success">Save</button>
                        <button onClick={() => setEditingFAQ(null)} className="btn-secondary">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setExpandedFAQ(expandedFAQ === faq.id ? null : faq.id)}
                        className="text-left w-full"
                      >
                        <h3 className="text-lg font-semibold text-gray-900 mb-2 hover:text-primary-600 transition-colors duration-200">
                          {faq.question}
                        </h3>
                      </button>
                      
                      <AnimatePresence>
                        {expandedFAQ === faq.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-4"
                          >
                            <p className="text-gray-700 leading-relaxed mb-4">{faq.answer}</p>
                            
                            <div className="flex items-center justify-between text-sm text-gray-500 pt-4 border-t border-gray-200">
                              <div className="flex items-center space-x-4">
                                {faq.frequency && (
                                  <span>Asked {faq.frequency} times</span>
                                )}
                                {faq.category && (
                                  <span className="px-2 py-1 bg-primary-100 text-primary-700 rounded-full text-xs">
                                    {faq.category}
                                  </span>
                                )}
                              </div>
                              <span>
                                {new Date(faq.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </div>

                {editingFAQ !== faq.id && (
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => handleEditFAQ(faq)}
                      className="text-gray-400 hover:text-primary-600 transition-colors duration-200"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteFAQ(faq.id)}
                      className="text-gray-400 hover:text-red-600 transition-colors duration-200"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
      </motion.div>

      {/* Results Summary */}
      {filteredFAQs.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 text-center text-sm text-gray-500"
        >
          Showing {filteredFAQs.length} of {faqs.length} FAQs
        </motion.div>
      )}
    </div>
  );
};

export default FAQDisplay;