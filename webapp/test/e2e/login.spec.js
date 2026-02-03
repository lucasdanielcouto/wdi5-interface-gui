describe('Login Page', () => {
    it('should login with valid credentials', async () => {
        await browser.asControl({ selector: { id: 'inputUser' } }).enterText('admin');
        await browser.asControl({ selector: { id: 'inputPass' } }).enterText('12345');
        await browser.asControl({ selector: { id: 'btnLogin' } }).press();
    });
});
