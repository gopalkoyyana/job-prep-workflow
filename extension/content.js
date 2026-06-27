// Scraper selectors for different job boards
const SITE_SELECTORS = {
  linkedin: {
    title: '.jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title, h1',
    company: '.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name',
    location: '.jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__bullet',
    description: '#job-details, .jobs-description__content',
    btnContainer: '.jobs-apply-button--top-card, .jobs-save-button, .job-details-jobs-unified-top-card__container'
  },
  indeed: {
    title: '.jobsearch-JobInfoHeader-title, h1',
    company: '[data-company-name="true"], .jobsearch-InlineCompanyRating',
    location: '.jobsearch-JobInfoHeader-subtitle div:last-child',
    description: '#jobDescriptionText',
    btnContainer: '#indeedApplyButtonContainer, .jobsearch-JobInfoHeader-actions'
  },
  naukri: {
    title: '.jd-header-title, h1',
    company: '.jd-header-comp-name, .pad-rt-8',
    location: '.location',
    description: '.job-desc, .clearBoth',
    btnContainer: '.apply-button-container, .jd-header-comp-name'
  }
};

function getSiteType() {
  const host = window.location.hostname;
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('indeed.com')) return 'indeed';
  if (host.includes('naukri.com')) return 'naukri';
  return null;
}

function scrapeJobDetails(siteType) {
  const sel = SITE_SELECTORS[siteType];
  if (!sel) return null;

  const titleEl = document.querySelector(sel.title);
  const companyEl = document.querySelector(sel.company);
  const locationEl = document.querySelector(sel.location);
  const descEl = document.querySelector(sel.description);

  if (!titleEl && !descEl) return null;

  // Clean values
  const title = titleEl ? titleEl.innerText.trim() : 'Unknown Role';
  let company = companyEl ? companyEl.innerText.trim() : 'Unknown Company';
  // Remove reviews or extra metadata from company name
  company = company.split('\n')[0].replace(/•.*/, '').trim();
  
  const location = locationEl ? locationEl.innerText.trim() : '';
  const description = descEl ? descEl.innerText.trim() : '';
  
  // Extract key requirements from description text
  const requirements = [];
  const lines = description.split('\n');
  lines.forEach(line => {
    const trimmed = line.trim();
    if ((trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) && trimmed.length > 5 && requirements.length < 8) {
      requirements.push(trimmed.substring(1).trim());
    }
  });

  return {
    title,
    company,
    location,
    description: description.substring(0, 1500), // Keep under limit or clean
    requirements: requirements.length ? requirements : ['Refer to description']
  };
}

// Injects the action button on the page
function injectButton() {
  const siteType = getSiteType();
  if (!siteType) return;

  const sel = SITE_SELECTORS[siteType];
  const container = document.querySelector(sel.btnContainer);
  if (!container || document.getElementById('job-prep-scrape-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'job-prep-scrape-btn';
  btn.innerText = '🎯 Prepare with AI';
  btn.style.cssText = `
    background: linear-gradient(135deg, #4f8ef7, #7c5cfc);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    margin-left: 8px;
    margin-right: 8px;
    box-shadow: 0 4px 12px rgba(79, 142, 247, 0.25);
    transition: all 0.2s ease;
    z-index: 9999;
  `;

  btn.onmouseover = () => { btn.style.opacity = '0.9'; btn.style.transform = 'translateY(-1px)'; };
  btn.onmouseout = () => { btn.style.opacity = '1'; btn.style.transform = 'none'; };

  btn.onclick = async () => {
    const jobData = scrapeJobDetails(siteType);
    if (!jobData) {
      alert('Could not scrape job details. Please try highlighting the text or click when the job description is fully loaded.');
      return;
    }

    btn.innerText = '⏳ Processing...';
    try {
      const response = await fetch('http://localhost:3000/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });
      const resData = await response.json();
      if (resData.success) {
        window.open(`http://localhost:3000?scrapeId=${resData.id}`, '_blank');
      } else {
        alert('Failed to send details to server.');
      }
    } catch (e) {
      console.error(e);
      alert('Could not connect to Job Prep Server on http://localhost:3000. Please make sure the backend server is running.');
    }
    btn.innerText = '🎯 Prepare with AI';
  };

  container.parentNode.insertBefore(btn, container.nextSibling);
}

// Poll or observe DOM changes to keep the button injected as the user clicks through different postings
setInterval(injectButton, 1500);
