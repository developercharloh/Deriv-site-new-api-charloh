export const doesCategoryMatchSearch = (category: HTMLElement, search: string) => {
    const search_term = search.replace(/\s+/g, ' ').trim().toUpperCase();

    if (!search_term) return true;

    const search_words = search_term.split(' ');
    const searchable_values = [category.getAttribute('name') || '', category.outerHTML];

    Array.from(category.querySelectorAll('block')).forEach(block => {
        const block_type = block.getAttribute('type') || '';
        searchable_values.push(block_type, block.outerHTML);

        const block_definition = window.Blockly?.Blocks?.[block_type];
        if (block_definition) {
            if (typeof block_definition.meta === 'function') {
                searchable_values.push(JSON.stringify(block_definition.meta()));
            }
            if (typeof block_definition.definition === 'function') {
                searchable_values.push(JSON.stringify(block_definition.definition()));
            }
        }
    });

    const searchable_text = searchable_values.join(' ').toUpperCase();
    return search_words.every(word => searchable_text.includes(word));
};