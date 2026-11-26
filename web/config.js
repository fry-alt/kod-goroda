// Адрес бэка для статического хостинга (Vercel): боевой API Андрея на сервере (deploy/kod.caddy, .github/workflows/deploy.yml).
// На своём сервере и на localhost фронт ходит в тот же адрес, откуда открыт. Если API недоступен — сам переходит на демо-данные.
// Другой адрес: ?api=https://… (запоминается в браузере). Сохранённые демо-данные без сервера: ?mock=4.
window.RADAR_API = /vercel\.app$|netlify\.app$|github\.io$/.test(location.hostname) ? 'https://kod.201-34-157-90.sslip.io' : '';

// Живые Google Forms (созданы tools/google_forms.gs): кнопки на дашборде и в кабинете стажёра.
window.RADAR_FORMS = {
  intern: 'https://docs.google.com/forms/d/e/1FAIpQLSfKEibPdE7mCFWVAMqYRKSEMdtNPMrxkj2AzvihiG13HjhrJQ/viewform',
  mentor: 'https://docs.google.com/forms/d/e/1FAIpQLSeGPIaOzTmS3iI8ARAuR_fUneWpGA9nRa9ZOL2p2vkAL-ZGbQ/viewform',
};
