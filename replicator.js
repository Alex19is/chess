// Standalone replicator script
// This script can clone the entire chess application

async function replicateChessApp(targetPath) {
    const sourcePath = '/chess/';
    
    // Get list of all files in chess app
    const manifest = await fetch(sourcePath + 'manifest.json').then(r => r.json());
    
    // Files to replicate (self-reference: includes replicator.js itself!)
    const files = [
        'index.html',
        'chess.js',
        'style.css',
        'manifest.json',
        'replicator.js',
        'games/template/metadata.json',
        'games/template/empty_moves.json'
    ];
    
    // Copy each file to target
    for (const file of files) {
        const content = await fetch(sourcePath + file).then(r => r.text());
        await fetch(targetPath + file, {
            method: 'PUT',
            body: content
        });
        console.log(`Replicated: ${file}`);
    }
    
    console.log(`✨ Chess app replicated to ${targetPath}`);
    console.log('This is a quine: the replicator just copied itself!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const target = process.argv[2] || '/chess-copy/';
    replicateChessApp(target);
}