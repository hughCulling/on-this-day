const GoogleParser = {
    id: 'google',
    name: 'Google Takeout',
    description: 'Select your extracted "Takeout" folder. This may take longer to process due to large HTML files.',

    async parseFiles(files, progressText, progressFill) {
        const events = [];
        let done = 0;

        for (const file of files) {
            try {
                // Extract service name from path: e.g. "Takeout/My Activity/Search/MyActivity.html" -> "Search"
                const pathParts = (file.webkitRelativePath || file.name).split('/');
                let service = 'Google';
                if (pathParts.length >= 2) {
                    service = pathParts[pathParts.length - 2];
                }

                if (progressText) {
                    progressText.textContent = `Parsing ${service}... (${done}/${files.length})`;
                }

                const text = await file.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const outerCells = doc.querySelectorAll('.outer-cell');

                outerCells.forEach(cell => {
                    const headerCell = cell.querySelector('.header-cell .mdl-typography--title');
                    if (headerCell) {
                        service = headerCell.textContent.trim();
                    }

                    const contentCells = cell.querySelectorAll('.content-cell');
                    let mainContentCell = null;

                    for (const c of contentCells) {
                        if (c.classList.contains('mdl-typography--body-1') && !c.classList.contains('mdl-typography--text-right')) {
                            mainContentCell = c;
                            break;
                        }
                    }

                    if (!mainContentCell) return;

                    let dateString = null;
                    let descriptionHTML = "";

                    const parts = mainContentCell.innerHTML.split(/<br\s*\/?>/i);
                    if (parts.length >= 2) {
                        const potentialDatePart = parts[1].replace(/&nbsp;/g, ' ').trim();
                        const cleanDatePart = potentialDatePart.replace(/<[^>]*>?/gm, '');
                        const parsedDate = new Date(cleanDatePart);
                        if (!isNaN(parsedDate.getTime())) {
                            dateString = cleanDatePart;
                            descriptionHTML = parts[0];
                        } else {
                            for (let i = parts.length - 1; i >= 0; i--) {
                                const clean = parts[i].replace(/<[^>]*>?/gm, '').trim();
                                const d = new Date(clean);
                                if (!isNaN(d.getTime()) && clean.length > 8) {
                                    dateString = clean;
                                    descriptionHTML = parts[0];
                                    break;
                                }
                            }
                        }
                    }

                    if (dateString) {
                        const dateObj = new Date(dateString);
                        let desc = descriptionHTML.trim();
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = desc;
                        let title = "";
                        let action = "";
                        const anchor = tempDiv.querySelector('a');
                        if (anchor) {
                            action = tempDiv.textContent.replace(anchor.textContent, '').trim();
                            title = anchor.textContent.trim();
                        } else {
                            title = tempDiv.textContent.trim();
                        }

                        let finalDescription = action ? `${action} "${title}"` : title;

                        events.push({
                            date: dateObj,
                            year: dateObj.getFullYear(),
                            type: service,
                            title: finalDescription,
                            description: '',
                            icon: this.getIconForService(service),
                            source: 'google',
                            sourceLabel: 'Google',
                            sourceIcon: '🔍',
                            sourceColor: '#ea4335',
                            timestamp: dateObj.getTime()
                        });
                    }
                });

            } catch (e) {
                console.warn(`Could not parse ${file.name}:`, e);
            }

            done++;
            if (progressFill) {
                progressFill.style.width = `${Math.round((done / files.length) * 100)}%`;
            }

            // Yield to main thread every file
            await new Promise(r => setTimeout(r, 0));
        }

        return events;
    },

    getIconForService(service) {
        const s = service.toLowerCase();
        if (s.includes('search')) return '🔍';
        if (s.includes('youtube')) return '📺';
        if (s.includes('assistant')) return '🤖';
        if (s.includes('maps')) return '🗺️';
        if (s.includes('play')) return '▶️';
        if (s.includes('chrome')) return '🌐';
        if (s.includes('ads')) return '📢';
        if (s.includes('discover')) return '📰';
        if (s.includes('lens')) return '📷';
        if (s.includes('flights')) return '✈️';
        if (s.includes('shopping')) return '🛍️';
        if (s.includes('books')) return '📚';
        if (s.includes('podcasts')) return '🎙️';
        if (s.includes('news')) return '📰';
        if (s.includes('calendar')) return '📅';
        if (s.includes('gmail')) return '📧';
        return 'G';
    }
};
