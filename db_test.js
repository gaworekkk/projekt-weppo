const db = require('./db');

async function testDB() {
    try {
        console.log('--- TEST BAZY DANYCH ---');

        // 1️⃣ Pobieranie istniejących danych
        const users = await db.getUsers();
        console.log('Użytkownicy:', users);

        const products = await db.getProducts();
        console.log('Produkty:', products);

        const categories = await db.getCategories();
        console.log('Kategorie:', categories);

        const promoCodes = await db.getPromoCodes();
        console.log('Kody promocyjne:', promoCodes);

        // 2️⃣ Dodawanie testowego użytkownika
        const testUser = {
            username: 'testuser@example.com',
            displayName: 'Test User',
            password: 'testhash',
            role: 'user'
        };
        await db.saveUser(testUser);
        console.log('Dodano testowego użytkownika');

        // 3️⃣ Dodawanie testowego produktu
        const categoryId = categories[0]?.id || 1; // jeśli brak kategorii, użyj 1
        const testProduct = {
            name: 'Test Product',
            description: 'Opis testowego produktu',
            price: 99.99,
            quantity: 10,
            categoryId
        };
        const testProductdelete = {
            name: 'Delete Product',
            description: 'Opis testowego produktu',
            price: 99.99,
            quantity: 10,
            categoryId
        };
        await db.saveProduct(testProductdelete);
        await db.saveProduct(testProduct);
        console.log('Dodano testowy produkt');

        // 4️⃣ Dodawanie testowego kodu promocyjnego
        const testPromo = { code: 'TEST10', discount: 12, active: true};
        await db.savePromoCode(testPromo);
        console.log('Dodano testowy kod promocyjny');

        // 5️⃣ Pobranie danych po dodaniu
        const updatedProducts = await db.getProducts();
        console.log('Produkty po dodaniu:', updatedProducts);

        const updatedUsers = await db.getUsers();
        console.log('Użytkownicy po dodaniu:', updatedUsers);

        const updatedPromo = await db.getPromoCodes();
        console.log('Kody promocyjne po dodaniu:', updatedPromo);

        // 6️⃣ Składanie zamówienia
        const orderItems = updatedProducts.slice(0, 1).map(p => ({
            productId: p.id,
            quantity: 2,
            price: p.price
        }));

        const user = updatedUsers.find(u => u.username === 'testuser@example.com');

        await db.saveOrder({
            userId: user.id,
            items: orderItems,
            total: orderItems.reduce((acc, i) => acc + i.price * i.quantity, 0)
        });
        console.log('Złożono testowe zamówienie');

        // 7️⃣ Czyszczenie testowych danych
        const newproducts = await db.getProducts();
        const deleteProduct = newproducts.find(p => p.name === 'Delete Product');
        console.log(deleteProduct);

        await db.updateProductQuantity(deleteProduct.id, 100);
        const pr = await db.getProducts();
        if (pr.find(p => p.id === deleteProduct.id).quantity === 100) {
            console.log('Zaktualizowano ilość testowego produktu');
        }
        if (deleteProduct) {
            await db.deleteProduct(deleteProduct.id);
        }
        await db.deletePromoCode('TEST10');
        console.log('Usunięto testowe dane');



        console.log('--- TEST ZAKOŃCZONY POMYŚLNIE ---');
        process.exit(0);

    } catch (err) {
        console.error('Błąd testu:', err);
        process.exit(1);
    }
}

testDB();
